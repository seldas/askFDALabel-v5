import re
import math
import random
import logging
import requests
from collections import Counter
from database import db, MeddraLLT, MeddraPT, MeddraMDHIER, OrangeBook
from dashboard.services.xml_handler import extract_sections_by_loinc
from dashboard.services.fda_client import get_label_xml, get_label_counts, find_labels, get_label_metadata
from dashboard.services.fdalabel_db import FDALabelDBService
from dashboard.services.meddra_matcher import scan_label_for_meddra
from dashboard.config import Config

logger = logging.getLogger(__name__)

class DeepDiveService:

    @classmethod
    def _get_meddra_mappings(cls, terms):
        """Fetches PT and SOC mappings for a list of terms to enable aggregation."""
        if not terms: return {}
        pt_map = {}
        try:
            llts = db.session.query(MeddraLLT.llt_name, MeddraPT.pt_name, MeddraMDHIER.soc_name)\
                .join(MeddraPT, MeddraLLT.pt_code == MeddraPT.pt_code)\
                .join(MeddraMDHIER, MeddraPT.pt_code == MeddraMDHIER.pt_code)\
                .filter(MeddraLLT.llt_name.in_(terms)).all()
            for llt_name, pt_name, soc_name in llts:
                pt_map[llt_name.upper()] = {'pt': pt_name.upper(), 'soc': soc_name}
            pts = db.session.query(MeddraPT.pt_name, MeddraMDHIER.soc_name)\
                .join(MeddraMDHIER, MeddraPT.pt_code == MeddraMDHIER.pt_code)\
                .filter(MeddraPT.pt_name.in_(terms)).all()
            for pt_name, soc_name in pts:
                pt_map[pt_name.upper()] = {'pt': pt_name.upper(), 'soc': soc_name}
        except Exception as e:
            logger.error(f"Error fetching MedDRA mappings: {e}")
        return pt_map

    @staticmethod
    def _determine_label_format(sections_dict):
        """
        Determines the label format based on presence of specific LOINC sections.
        PLR: has 'Warnings and Precautions' (43685-7)
        non-PLR: has 'Adverse Reactions' (34084-4) but NO 'Warnings and Precautions'
        OTC: Has neither
        """
        if '43685-7' in sections_dict:
            return 'PLR'
        if '34084-4' in sections_dict:
            return 'non-PLR'
        return 'OTC'

    @classmethod
    def get_comparison_analysis(cls, target_set_id, source='local', generic_names=None, epcs=None):
        """Builds a Compliance Matrix with Traceability and Peer References using local DB."""
        target_xml = get_label_xml(target_set_id)
        if not target_xml: return {"error": "Target XML not found"}
        target_sections = extract_sections_by_loinc(target_xml)
        target_format = cls._determine_label_format(target_sections)
        
        # Ensure we have generic_names
        active_names = generic_names
        if not active_names or active_names.lower() == 'n/a':
            meta = get_label_metadata(target_set_id)
            if meta:
                active_names = meta.get('generic_name')
        
        # Borrow EPC if missing from target or provided parameters
        active_epcs = epcs
        if not active_epcs or active_epcs.lower() == 'n/a':
            active_epcs = cls._borrow_epc(target_set_id, active_names)
            logger.info(f"Borrowed EPC for {target_set_id}: {active_epcs}")

        logger.info(f"Sampling peers for {target_set_id} with names='{active_names}' and epcs='{active_epcs}'")
        peer_set_ids = cls._get_peer_sample(source, active_names, active_epcs, target_format, target_set_id=target_set_id)
        
        HIERARCHY = {
            '34066-1': {'level': 3, 'code': 'B', 'label': 'Boxed Warning'},
            '34071-1': {'level': 2, 'code': 'W', 'label': 'Warning'},
            '43685-7': {'level': 2, 'code': 'W', 'label': 'Warning'},
            '34084-4': {'level': 1, 'code': 'A', 'label': 'Adverse Reaction'}
        }

        def scan_sections(sections_dict, sid):
            raw_data = {}
            stats = {'hits': 0, 'misses': 0}
            for loinc, data in sections_dict.items():
                if loinc in HIERARCHY:
                    text = data.get('content', '')
                    if text: 
                        terms, is_hit = scan_label_for_meddra(text, set_id=sid, section_loinc=loinc, return_stats=True)
                        raw_data[loinc] = terms
                        if is_hit: stats['hits'] += 1
                        else: stats['misses'] += 1
            return raw_data, stats

        analysis_stats = {'cache_hits': 0, 'cache_misses': 0}
        target_raw, t_stats = scan_sections(target_sections, target_set_id)
        analysis_stats['cache_hits'] += t_stats['hits']
        analysis_stats['cache_misses'] += t_stats['misses']

        peers_raw = []
        all_unique_terms = set()
        peers_meta = {}
        
        for pid in peer_set_ids:
            if pid == target_set_id: continue
            pm = get_label_metadata(pid)
            if pm:
                peers_meta[pid] = {
                    'brand': pm.get('brand_name', 'Unknown'),
                    'manufacturer': pm.get('manufacturer_name', 'Unknown')
                }
            pxml = get_label_xml(pid)
            if pxml:
                p_sections = extract_sections_by_loinc(pxml)
                p_raw, p_stats = scan_sections(p_sections, pid)
                analysis_stats['cache_hits'] += p_stats['hits']
                analysis_stats['cache_misses'] += p_stats['misses']
                peers_raw.append({'id': pid, 'data': p_raw})
                for loinc_terms in p_raw.values(): all_unique_terms.update(loinc_terms)
        
        for loinc_terms in target_raw.values(): all_unique_terms.update(loinc_terms)
        mappings = cls._get_meddra_mappings(list(all_unique_terms))
        
        def normalize_to_pt_levels(raw_data_dict):
            pt_levels = {}
            for loinc, terms in raw_data_dict.items():
                lvl_info = HIERARCHY[loinc]
                for t in terms:
                    m = mappings.get(t.upper())
                    if m:
                        pt = m['pt']
                        cur = pt_levels.get(pt, {'level': 0, 'originals': set()})
                        new_originals = cur['originals']
                        new_originals.add(t)
                        if lvl_info['level'] > cur['level']:
                            pt_levels[pt] = {**lvl_info, 'soc': m['soc'], 'originals': new_originals}
                        else:
                            pt_levels[pt]['originals'] = new_originals
            for pt in pt_levels:
                pt_levels[pt]['originals'] = sorted(list(pt_levels[pt]['originals']))
            return pt_levels

        target_pt_levels = normalize_to_pt_levels(target_raw)
        peers_pt_data = [{'id': p['id'], 'pts': normalize_to_pt_levels(p['data'])} for p in peers_raw]
        
        all_pts = set(target_pt_levels.keys())
        for p in peers_pt_data: all_pts.update(p['pts'].keys())
        
        total_peers = len(peers_pt_data)
        term_stats = {}
        for pt in all_pts:
            peer_codes = [p['pts'].get(pt, {'code': 'N'})['code'] for p in peers_pt_data]
            counts = Counter(peer_codes)
            dist = {
                'B': round((counts['B'] / total_peers * 100) if total_peers > 0 else 0),
                'W': round((counts['W'] / total_peers * 100) if total_peers > 0 else 0),
                'A': round((counts['A'] / total_peers * 100) if total_peers > 0 else 0),
                'N': round((counts['N'] / total_peers * 100) if total_peers > 0 else 0)
            }
            consensus_code = counts.most_common(1)[0][0] if counts else 'N'
            target_status = target_pt_levels.get(pt, {'level': 0, 'code': 'N', 'soc': 'Unknown', 'originals': []})
            
            LEVEL_MAP = {'B': 3, 'W': 2, 'A': 1, 'N': 0}
            target_level = LEVEL_MAP[target_status['code']]
            consensus_level = LEVEL_MAP[consensus_code]
            
            peer_count = sum(1 for c in peer_codes if c != 'N')
            peer_coverage = (peer_count / total_peers * 100) if total_peers > 0 else 0
            
            term_stats[pt] = {
                'term': pt,
                'originals': target_status.get('originals', []),
                'soc': target_status.get('soc', 'Unknown'),
                'target_code': target_status['code'],
                'target_level': target_level,
                'consensus_code': consensus_code,
                'consensus_level': consensus_level,
                'distribution': dist,
                'peer_coverage': peer_coverage,
                'peer_count': peer_count,
                'weight': consensus_level * peer_coverage,
                'peers': peer_codes
            }

        tiers = {'critical': [], 'moderate': [], 'minor': []}
        matrix_rows = []
        for pt, stats in term_stats.items():
            is_downgraded = stats['target_level'] < stats['consensus_level'] and stats['consensus_level'] > 0
            is_missing = stats['target_level'] == 0 and stats['consensus_level'] > 0 and stats['peer_coverage'] >= 50
            if is_missing:
                tier = 'critical' if stats['consensus_level'] >= 2 else 'moderate'
                stats['note'] = f"Missing Signal: Class consensus is {stats['consensus_code']}."
                tiers[tier].append(stats)
            elif is_downgraded:
                stats['note'] = f"Downgraded: Peer consensus ({stats['consensus_code']}) is higher level."
                tiers['moderate'].append(stats)
            
            is_discrepancy = stats['target_code'] != stats['consensus_code']
            if is_discrepancy and not is_missing and not is_downgraded and stats['peer_coverage'] > 20:
                tiers['minor'].append(stats)

            if stats['peer_coverage'] > 10 or is_discrepancy or stats['target_level'] >= 2:
                matrix_rows.append({
                    'term': pt,
                    'originals': stats['originals'],
                    'soc': stats['soc'],
                    'target': stats['target_code'],
                    'consensus': stats['consensus_code'],
                    'coverage': f"{int(stats['peer_coverage'])}%",
                    'dist': stats['distribution'],
                    'peers': stats['peers'],
                    'is_discrepancy': is_discrepancy
                })

        LEVEL_MAP = {'B': 3, 'W': 2, 'A': 1, 'N': 0}
        matrix_rows.sort(key=lambda x: (LEVEL_MAP.get(x['target'], 0), x['term']), reverse=True)
        for t in tiers: tiers[t].sort(key=lambda x: x['weight'], reverse=True)

        return {
            'matrix': matrix_rows,
            'tiers': tiers,
            'peer_count': total_peers,
            'peers_metadata': peers_meta,
            'target_set_id': target_set_id,
            'borrowed_epc': active_epcs,
            '_stats': analysis_stats
        }

    @classmethod
    def _borrow_epc(cls, set_id, generic_names):
        """Attempts to find an EPC for the given set_id or generic names from other labels."""
        if not FDALabelDBService.check_connectivity(): return None

        conn = FDALabelDBService.get_connection()
        if not conn: return None

        try:
            cursor = conn.cursor()
            schema = "labeling."

            # 1. Try by appr_num first (most specific)
            cursor.execute(f"SELECT appr_num FROM {schema}sum_spl WHERE set_id = %s", (set_id,))
            res = cursor.fetchone()
            appr_num = res['appr_num'] if res else None

            if appr_num and appr_num != 'N/A':
                cursor.execute(f"SELECT epc FROM {schema}sum_spl WHERE appr_num = %s AND epc IS NOT NULL AND epc != '' AND epc != 'N/A' LIMIT 1", (appr_num,))
                res = cursor.fetchone()
                if res and res['epc']:
                    return res['epc']

            # 2. Try by generic_names in substance_indexing table (high quality)
            gn_list = [n.strip().upper() for n in (generic_names or "").split(',') if n.strip() and n.strip().lower() != 'n/a']
            if not gn_list:
                cursor.execute(f"SELECT generic_names FROM {schema}sum_spl WHERE set_id = %s", (set_id,))
                res = cursor.fetchone()
                if res and res['generic_names']:
                    gn_list = [n.strip().upper() for n in res['generic_names'].split(';') if n.strip()]

            if gn_list:
                # Search for EPC, MoA, or PE in indexing table
                # We prioritize EPC [EPC]
                for gn in gn_list:
                    cursor.execute(f"""
                        SELECT indexing_name 
                        FROM {schema}substance_indexing 
                        WHERE UPPER(substance_name) = %s 
                        ORDER BY 
                            CASE WHEN indexing_type = 'EPC' THEN 1 
                                 WHEN indexing_type = 'MoA' THEN 2
                                 WHEN indexing_type = 'PE' THEN 3
                                 ELSE 4 END
                        LIMIT 1
                    """, (gn,))
                    res = cursor.fetchone()
                    if res and res['indexing_name']:
                        return res['indexing_name']

            # 3. Fallback to other labels with same generic name
            for gn in gn_list:
                cursor.execute(f"SELECT epc FROM {schema}sum_spl WHERE generic_names ILIKE %s AND epc IS NOT NULL AND epc != '' AND epc != 'N/A' LIMIT 1", (f"%{gn}%",))
                res = cursor.fetchone()
                if res and res['epc']:
                    return res['epc']

            # 4. Final fallback to openFDA rich metadata
            if gn_list:
                from dashboard.services.fda_client import get_rich_metadata_by_generic
                rich_meta = get_rich_metadata_by_generic(gn_list[0])
                if rich_meta and rich_meta.get('epc'):
                    return rich_meta['epc']

        except Exception as e:
            logger.error(f"Error borrowing EPC: {e}")
        finally:
            conn.close()
        return None

    @classmethod
    def _get_peer_sample(cls, source, generic_names, epcs, target_format, target_set_id=None):
        """
        Samples up to 25 peers using local PostgreSQL labeling schema.
        Prioritizes UNII-based EPC matching, then generic names and EPC expansion.
        """
        if not FDALabelDBService.check_connectivity(): return []
        
        conn = FDALabelDBService.get_connection()
        if not conn: return []
        
        all_peer_data = [] # List of {id, is_rld, format, score}
        unique_set_ids = set()
        schema = "labeling."

        try:
            cursor = conn.cursor()
            
            # 1. Gather by UNII-based EPC logic (Deepest Link)
            if target_set_id:
                try:
                    # Find all SPL IDs that share the same EPC as the target, linked by UNII
                    sql_unii = f"""
                        WITH target_unii AS (
                            SELECT unii FROM {schema}active_ingredients_map WHERE spl_id = (SELECT spl_id FROM {schema}sum_spl WHERE set_id = %s LIMIT 1) AND unii != ''
                        ),
                        target_epc AS (
                            SELECT DISTINCT indexing_name FROM {schema}substance_indexing WHERE (substance_unii IN (SELECT unii FROM target_unii) OR substance_name IN (SELECT substance_name FROM {schema}active_ingredients_map WHERE spl_id = (SELECT spl_id FROM {schema}sum_spl WHERE set_id = %s LIMIT 1))) AND indexing_type = 'EPC'
                        ),
                        related_unii AS (
                            SELECT DISTINCT substance_unii FROM {schema}substance_indexing WHERE indexing_name IN (SELECT indexing_name FROM target_epc) AND substance_unii != ''
                        )
                        SELECT DISTINCT s.set_id, s.is_rld, s.doc_type
                        FROM {schema}sum_spl s
                        JOIN {schema}spl_sections sec ON s.spl_id = sec.spl_id
                        JOIN {schema}active_ingredients_map m ON s.spl_id = m.spl_id
                        WHERE m.unii IN (SELECT substance_unii FROM related_unii)
                        LIMIT 100
                    """
                    cursor.execute(sql_unii, (target_set_id, target_set_id))
                    for row in cursor.fetchall():
                        sid = row['set_id']
                        if sid not in unique_set_ids:
                            unique_set_ids.add(sid)
                            fmt = 'PLR' if 'PRESCRIPTION' in (row['doc_type'] or '').upper() else 'OTC'
                            all_peer_data.append({
                                'id': sid,
                                'is_rld': bool(row['is_rld']),
                                'format': fmt,
                                'score': 10 + (2 if fmt == target_format else 0)
                            })
                except Exception as e:
                    logger.error(f"Error in UNII-based peer sampling: {e}")

            name_list = [n.strip() for n in (generic_names or "").split(',') if n.strip() and n.strip().lower() != 'n/a']
            epc_list = [e.strip() for e in (epcs or "").split(',') if e.strip() and e.strip().lower() != 'n/a']

            # 2. Gather by Generic Names (Direct)
            for gn in name_list[:3]:
                # Join with spl_sections to ensure we only pick labels with actual XML content
                sql = f"""
                    SELECT DISTINCT s.set_id, s.is_rld, s.doc_type 
                    FROM {schema}sum_spl s
                    JOIN {schema}spl_sections sec ON s.spl_id = sec.spl_id
                    WHERE s.generic_names ILIKE %s LIMIT 100
                """
                cursor.execute(sql, (f"%{gn}%",))
                for row in cursor.fetchall():
                    sid = row['set_id']
                    if sid not in unique_set_ids:
                        unique_set_ids.add(sid)
                        fmt = 'PLR' if 'PRESCRIPTION' in (row['doc_type'] or '').upper() else 'OTC'
                        all_peer_data.append({
                            'id': sid,
                            'is_rld': bool(row['is_rld']),
                            'format': fmt,
                            'score': 8 + (2 if fmt == target_format else 0)
                        })

            # 3. Gather by EPCs (Expansion Logic)
            for epc in epc_list[:3]:
                clean_epc = epc.split('[')[0].strip()
                # A. Find all unique generic names that share this EPC
                sql_gns = f"""
                    SELECT DISTINCT generic_names 
                    FROM {schema}sum_spl s
                    LEFT JOIN {schema}epc_map e ON s.spl_id = e.spl_id
                    WHERE s.epc ILIKE %s OR e.epc_term ILIKE %s OR s.epc ILIKE %s OR e.epc_term ILIKE %s
                """
                cursor.execute(sql_gns, (f"%{epc}%", f"%{epc}%", f"%{clean_epc}%", f"%{clean_epc}%"))
                all_gns = set()
                for row in cursor.fetchall():
                    gn_str = row['generic_names']
                    if gn_str:
                        for g in gn_str.split(';'):
                            if g.strip(): all_gns.add(g.strip().upper())
                
                if all_gns:
                    # B. Sample labels from these generic names
                    gns_sample = list(all_gns)[:10]
                    where_parts = ["s.generic_names ILIKE %s"] * len(gns_sample)
                    sql_peers = f"""
                        SELECT DISTINCT s.set_id, s.is_rld, s.doc_type
                        FROM {schema}sum_spl s
                        JOIN {schema}spl_sections sec ON s.spl_id = sec.spl_id
                        WHERE {' OR '.join(where_parts)}
                        LIMIT 100
                    """
                    cursor.execute(sql_peers, [f"%{gn}%" for gn in gns_sample])
                    for row in cursor.fetchall():
                        sid = row['set_id']
                        if sid not in unique_set_ids:
                            unique_set_ids.add(sid)
                            fmt = 'PLR' if 'PRESCRIPTION' in (row['doc_type'] or '').upper() else 'OTC'
                            all_peer_data.append({
                                'id': sid,
                                'is_rld': bool(row['is_rld']),
                                'format': fmt,
                                'score': 5 + (2 if fmt == target_format else 0)
                            })

            # 4. Sort and Sample
            # We want a diverse sample but high quality
            random.shuffle(all_peer_data)
            all_peer_data.sort(key=lambda x: x['score'], reverse=True)
            
            final_sample = [p['id'] for p in all_peer_data[:25]]
            logger.info(f"Peer Sampling Result: Collected {len(all_peer_data)} candidates, returning {len(final_sample)} for analysis.")
            return final_sample

        except Exception as e:
            logger.error(f"Error sampling peers locally: {e}")
            return []
        finally:
            conn.close()

    @staticmethod
    def _query_local_full_meta(generic_name=None, epc=None):
        """Deprecated: Replaced by optimized local sampling."""
        return []

    @staticmethod
    def _query_local_ids(generic_name=None, epc=None):
        """Deprecated: Replaced by optimized local sampling."""
        return []
