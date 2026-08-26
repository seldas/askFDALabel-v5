"""
PV-Profile Service (Pharmacovigilance & Side Effect Profile)

Extracts, structures, and enriches adverse events and safety warnings from
FDA drug labelings (supporting PLR, Non-PLR, and OTC formats).
Provides standardized Severity Tiers (1-5), quantitative drug vs. placebo frequencies,
MedDRA hierarchy enrichment, and same-drug peer lookup.
"""

import json
import logging
import re
from datetime import datetime
try:
    import defusedxml.ElementTree as ET
except ImportError:
    import xml.etree.ElementTree as ET

from sqlalchemy import func
from database import db, DrugLabel, MeddraPT, MeddraLLT, MeddraSOC, MeddraMDHIER, LabelPvProfile
from dashboard.services.fdalabel_db import FDALabelDBService
from dashboard.services.ai_handler import call_llm
from dashboard.services.xml_handler import identify_label_format, get_local_name

logger = logging.getLogger(__name__)

# --- SEVERITY TIER DEFINITIONS ---
SEVERITY_TIERS = {
    1: {
        'level': 1,
        'name': 'Critical / Boxed Warning',
        'badge': 'BOXED',
        'color': '#ef4444', # Red
        'description': 'Boxed Warnings, Black Box Warnings, or OTC Do Not Use / Allergy Alerts'
    },
    2: {
        'level': 2,
        'name': 'Contraindications / Severe Warning',
        'badge': 'CONTRAINDICATION',
        'color': '#f97316', # Deep Orange
        'description': 'Contraindications or OTC Stop Use & Ask Doctor If'
    },
    3: {
        'level': 3,
        'name': 'Warnings & Precautions',
        'badge': 'WARNING',
        'color': '#eab308', # Amber/Yellow
        'description': 'Warnings, Precautions, or OTC Ask Doctor Before Use'
    },
    4: {
        'level': 4,
        'name': 'Adverse Reactions (Clinical Trials)',
        'badge': 'ADVERSE REACTION',
        'color': '#3b82f6', # Blue
        'description': 'Clinical trials adverse reactions and quantitative incidence rates'
    },
    5: {
        'level': 5,
        'name': 'Postmarketing / General Precautions',
        'badge': 'POSTMARKETING',
        'color': '#64748b', # Slate/Gray
        'description': 'Postmarketing spontaneous reports or general safety observations'
    }
}

# LOINC codes mapped to Severity Tier
LOINC_SEVERITY_MAP = {
    # Tier 1: Boxed Warning / OTC Do Not Use
    '34066-1': 1, # Boxed Warning
    '50570-1': 1, # OTC - Do Not Use
    '50741-8': 1, # Safe Handling / Allergy Alert

    # Tier 2: Contraindications / OTC Stop Use
    '34070-3': 2, # Contraindications
    '50566-9': 2, # OTC - Stop Use

    # Tier 3: Warnings & Precautions / OTC Ask Doctor
    '43685-7': 3, # Warnings and Precautions (PLR)
    '34071-1': 3, # Warnings (Non-PLR)
    '42232-9': 3, # Precautions (Non-PLR)
    '50569-3': 3, # OTC - Ask Doctor
    '50568-5': 3, # OTC - Ask Doctor/Pharmacist

    # Tier 4: Adverse Reactions / Clinical Trials / OTC When Using
    '34084-4': 4, # Adverse Reactions
    '90374-0': 4, # Clinical Trials Experience
    '50567-7': 4, # OTC - When Using

    # Tier 5: Postmarketing Experience / Other
    '90375-7': 5, # Postmarketing Experience
    '34072-9': 5, # General Precautions
    '54433-8': 5, # User Safety Warnings
    '50744-2': 5, # Information for Owners/Caregivers
    '60561-8': 5, # Other Safety Information
}

AI_EXTRACTION_SYSTEM_PROMPT = """You are an expert clinical pharmacovigilance and FDA drug labeling extraction system.
Your task is to extract all adverse reactions, side effects, and safety warnings from the provided drug label sections.

For each distinct adverse event or safety risk found, extract:
1. "term": Exact name/phrase used in the text.
2. "meddra_pt_candidate": Proposed MedDRA Preferred Term (PT) in standard clinical English (e.g., "Nausea", "Headache", "Alanine aminotransferase increased", "Anaphylactic reaction").
3. "severity_tier": Integer (1 to 5) based on the section's severity:
   - 1: Boxed Warning, Black Box, OTC Do Not Use, Allergy Alert
   - 2: Contraindications, OTC Stop Use
   - 3: Warnings and Precautions, OTC Ask Doctor Before Use
   - 4: Adverse Reactions, Clinical Trials Experience, OTC When Using
   - 5: Postmarketing Experience, Spontaneous Reports, General Precautions
4. "section_name": Name of the source section.
5. "is_quantitative": true if a numerical frequency (% or n/N) is mentioned, false if qualitative only.
6. "drug_frequency_text": Exact frequency text for the drug if reported (e.g. "15%", "11.1% - 38.2%", "common", or null).
7. "drug_min_pct": Minimum numerical percentage for drug (e.g. 11.1), or null if not quantitative.
8. "drug_max_pct": Maximum numerical percentage for drug (e.g. 38.2), or null if not quantitative.
9. "placebo_frequency_text": Frequency text for placebo if reported (e.g. "4.5%", "2% - 5%", or null).
10. "placebo_pct": Numerical percentage for placebo (e.g. 4.5), or null if not reported.
11. "frequency_category": One of ["very_common", "common", "uncommon", "rare", "very_rare", "not_quantified"].
    Classification guide:
    - very_common: >= 10%
    - common: 1% to < 10%
    - uncommon: 0.1% to < 1%
    - rare: 0.01% to < 0.1%
    - very_rare: < 0.01%
    - not_quantified: if no exact frequency is available (e.g. in Boxed Warnings, Warnings, Postmarketing)
12. "excerpt": A brief, exact quote (10-35 words) from the source text showing where this reaction is described.

Output MUST be a valid JSON array of objects with no Markdown backticks or commentary outside the JSON array:
[
  {
    "term": "...",
    "meddra_pt_candidate": "...",
    "severity_tier": 4,
    "section_name": "...",
    "is_quantitative": true,
    "drug_frequency_text": "...",
    "drug_min_pct": 12.0,
    "drug_max_pct": 12.0,
    "placebo_frequency_text": "...",
    "placebo_pct": 3.0,
    "frequency_category": "very_common",
    "excerpt": "..."
  }
]
"""


class PVProfileService:

    @classmethod
    def harvest_safety_sections(cls, xml_content):
        """
        Parses SPL XML and extracts all safety sections (Tiers 1-5)
        for PLR, Non-PLR, and OTC Drug Facts.
        """
        if not xml_content:
            return {'format': 'UNKNOWN', 'sections': []}

        try:
            clean_xml = xml_content.encode('ascii', 'ignore').decode('ascii')
            root = ET.fromstring(clean_xml)
        except Exception as e:
            logger.error(f"Error parsing XML for safety sections: {e}")
            return {'format': 'UNKNOWN', 'sections': []}

        label_format = identify_label_format(root)
        sections = []
        ns = {'v3': 'urn:hl7-org:v3'}

        # Find all sections in the SPL
        section_nodes = root.findall(".//v3:section", ns)
        if not section_nodes:
            section_nodes = [node for node in root.iter() if get_local_name(node) == 'section']

        seen_codes_and_titles = set()

        for s in section_nodes:
            code_el = s.find("v3:code", ns) if 'v3' in s.tag or s.find("v3:code", ns) is not None else None
            if code_el is None:
                code_el = next((c for c in s if get_local_name(c) == 'code'), None)

            title_el = s.find("v3:title", ns) if 'v3' in s.tag or s.find("v3:title", ns) is not None else None
            if title_el is None:
                title_el = next((t for t in s if get_local_name(t) == 'title'), None)

            code_val = code_el.get('code') if code_el is not None else ''
            title_text = "".join(title_el.itertext()).strip() if title_el is not None else ''
            title_upper = title_text.upper()

            tier = None
            section_name = title_text

            # 1. Match by LOINC code
            if code_val in LOINC_SEVERITY_MAP:
                tier = LOINC_SEVERITY_MAP[code_val]
                if not section_name:
                    section_name = f"LOINC {code_val}"

            # 2. Fallback: Match by title keywords if LOINC is unclassified
            if tier is None and title_upper:
                if any(w in title_upper for w in ['BOXED WARNING', 'BLACK BOX']):
                    tier = 1
                elif 'DO NOT USE' in title_upper or 'ALLERGY ALERT' in title_upper:
                    tier = 1
                elif 'CONTRAINDICATION' in title_upper or 'STOP USE' in title_upper:
                    tier = 2
                elif any(w in title_upper for w in ['WARNINGS AND PRECAUTIONS', 'WARNINGS', 'PRECAUTIONS', 'ASK A DOCTOR', 'ASK DOCTOR']):
                    tier = 3
                elif any(w in title_upper for w in ['ADVERSE REACTIONS', 'ADVERSE EVENTS', 'SIDE EFFECTS', 'WHEN USING THIS PRODUCT', 'CLINICAL TRIALS EXPERIENCE']):
                    tier = 4
                elif any(w in title_upper for w in ['POSTMARKETING', 'POST-MARKETING', 'GENERAL PRECAUTIONS', 'OTHER INFORMATION']):
                    tier = 5

            if tier is not None:
                # Extract text content from section
                text_content = "".join(s.itertext()).strip()
                # Clean multiple spaces and line breaks
                text_content = re.sub(r'\s+', ' ', text_content)

                if text_content and len(text_content) > 30:
                    dedup_key = (code_val, title_upper[:30])
                    if dedup_key not in seen_codes_and_titles:
                        seen_codes_and_titles.add(dedup_key)
                        sections.append({
                            'code': code_val,
                            'title': section_name or f"Tier {tier} Safety Section",
                            'severity_tier': tier,
                            'text': text_content[:15000] # Cap long sections to 15k chars
                        })

        # Sort sections by severity tier ascending (1 -> 5)
        sections.sort(key=lambda x: x['severity_tier'])

        return {
            'format': label_format,
            'sections': sections
        }

    @classmethod
    def _parse_json_response(cls, raw_response):
        """
        Robustly parses a JSON list from LLM output, with fallback to regex object extraction
        if the stream was truncated or enclosed in markdown fences.
        """
        if not raw_response:
            return []

        cleaned = raw_response.strip()
        # Remove Markdown code blocks
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].startswith("```"):
                lines = lines[:-1]
            cleaned = "\n".join(lines).strip()

        # 1. Direct JSON parse
        try:
            items = json.loads(cleaned)
            if isinstance(items, list):
                return items
        except Exception:
            pass

        # 2. Try slicing from first '[' to last ']'
        try:
            start = cleaned.find('[')
            end = cleaned.rfind(']')
            if start != -1 and end != -1 and end > start:
                items = json.loads(cleaned[start:end+1])
                if isinstance(items, list):
                    return items
        except Exception:
            pass

        # 3. Resilient regex fallback: find all complete individual JSON objects
        items = []
        pattern = re.compile(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}')
        for match in pattern.finditer(cleaned):
            try:
                obj = json.loads(match.group(0))
                if isinstance(obj, dict) and ('term' in obj or 'meddra_pt_candidate' in obj):
                    items.append(obj)
            except Exception:
                continue

        return items

    @classmethod
    def extract_pv_with_ai(cls, label_format, sections, user=None):
        """
        Calls LLM to extract structured adverse events and frequencies.
        """
        if not sections:
            return []

        # Build user prompt
        prompt_parts = [
            f"Please analyze the safety sections for this {label_format} drug labeling.",
            "Extract all adverse reactions, side effects, and safety warnings strictly into the required JSON array format.",
            "Keep excerpts concise (10-25 words max).\n"
        ]

        for s in sections:
            prompt_parts.append(
                f"--- SECTION: {s['title']} (LOINC: {s['code']}, Severity Tier: {s['severity_tier']}) ---\n"
                f"{s['text']}\n"
            )

        user_message = "\n".join(prompt_parts)

        try:
            raw_response = call_llm(
                user=user,
                system_prompt=AI_EXTRACTION_SYSTEM_PROMPT,
                user_message=user_message,
                temperature=0.05,
                max_tokens=16384
            )

            if not raw_response:
                logger.error("AI returned empty response for PV extraction.")
                return []

            items = cls._parse_json_response(raw_response)
            if not items:
                logger.error("Failed to parse any adverse event items from AI response.")
                return []

            # Normalize values
            normalized = []
            for item in items:
                if not isinstance(item, dict):
                    continue
                term = (item.get('term') or '').strip()
                pt = (item.get('meddra_pt_candidate') or term).strip()
                if not term and not pt:
                    continue

                tier = item.get('severity_tier')
                try:
                    tier = int(tier)
                    if tier not in SEVERITY_TIERS:
                        tier = 4
                except (ValueError, TypeError):
                    tier = 4

                drug_min = item.get('drug_min_pct')
                drug_max = item.get('drug_max_pct')
                placebo_pct = item.get('placebo_pct')

                # Ensure numbers or None
                def _to_float(v):
                    if v is None: return None
                    try:
                        f = float(v)
                        return round(f, 2)
                    except (ValueError, TypeError):
                        return None

                drug_min = _to_float(drug_min)
                drug_max = _to_float(drug_max)
                placebo_pct = _to_float(placebo_pct)

                if drug_min is not None and drug_max is None:
                    drug_max = drug_min
                elif drug_max is not None and drug_min is None:
                    drug_min = drug_max

                # Determine frequency category
                freq_cat = item.get('frequency_category') or 'not_quantified'
                if drug_max is not None:
                    if drug_max >= 10.0:
                        freq_cat = 'very_common'
                    elif drug_max >= 1.0:
                        freq_cat = 'common'
                    elif drug_max >= 0.1:
                        freq_cat = 'uncommon'
                    elif drug_max >= 0.01:
                        freq_cat = 'rare'
                    else:
                        freq_cat = 'very_rare'

                # Calculate placebo risk difference
                risk_diff = None
                if drug_max is not None and placebo_pct is not None:
                    risk_diff = round(drug_max - placebo_pct, 2)

                normalized.append({
                    'term': term or pt,
                    'meddra_pt': pt,
                    'severity_tier': tier,
                    'section_name': item.get('section_name') or f"Tier {tier} Section",
                    'is_quantitative': bool(item.get('is_quantitative', drug_max is not None)),
                    'drug_frequency_text': item.get('drug_frequency_text'),
                    'drug_min_pct': drug_min,
                    'drug_max_pct': drug_max,
                    'placebo_frequency_text': item.get('placebo_frequency_text'),
                    'placebo_pct': placebo_pct,
                    'risk_difference_pct': risk_diff,
                    'frequency_category': freq_cat,
                    'excerpt': item.get('excerpt') or ''
                })

            return normalized

        except Exception as e:
            logger.error(f"Error in AI PV extraction: {e}")
            return []

    @classmethod
    def enrich_with_meddra(cls, items):
        """
        Maps PT candidate terms to standard MedDRA PT, PT Code, and Primary SOC
        using PostgreSQL MedDRA database tables.
        """
        if not items:
            return []

        # Collect unique PT candidate names
        pt_names = list(set([item['meddra_pt'].strip() for item in items if item.get('meddra_pt')]))
        pt_map = {}

        try:
            # Query MedDRA PT -> MDHier -> SOC
            # We look for exact match (case-insensitive)
            for name in pt_names:
                # 1. Look up in MeddraPT
                pt_record = db.session.query(MeddraPT).filter(
                    func.lower(MeddraPT.pt_name) == name.lower()
                ).first()

                if not pt_record:
                    # 2. Look up in MeddraLLT
                    llt_record = db.session.query(MeddraLLT).filter(
                        func.lower(MeddraLLT.llt_name) == name.lower()
                    ).first()
                    if llt_record and llt_record.pt_code:
                        pt_record = db.session.query(MeddraPT).filter_by(pt_code=llt_record.pt_code).first()

                if pt_record:
                    # Find primary SOC via MeddraMDHIER
                    mdhier = db.session.query(MeddraMDHIER).filter_by(pt_code=pt_record.pt_code).first()
                    soc_name = 'General disorders and administration site conditions'
                    soc_code = 10018065
                    if mdhier and mdhier.soc_code:
                        soc_rec = db.session.query(MeddraSOC).filter_by(soc_code=mdhier.soc_code).first()
                        if soc_rec:
                            soc_name = soc_rec.soc_name
                            soc_code = soc_rec.soc_code

                    pt_map[name.lower()] = {
                        'pt_name': pt_record.pt_name,
                        'pt_code': pt_record.pt_code,
                        'soc_name': soc_name,
                        'soc_code': soc_code
                    }
        except Exception as e:
            logger.error(f"Error querying MedDRA database tables: {e}")

        # Enrich items
        enriched = []
        for item in items:
            item_copy = dict(item)
            pt_key = item['meddra_pt'].lower()
            if pt_key in pt_map:
                m = pt_map[pt_key]
                item_copy['meddra_pt'] = m['pt_name']
                item_copy['meddra_pt_code'] = m['pt_code']
                item_copy['soc_name'] = m['soc_name']
                item_copy['soc_code'] = m['soc_code']
            else:
                item_copy['meddra_pt_code'] = None
                item_copy['soc_name'] = 'General / Unclassified disorders'
                item_copy['soc_code'] = None

            enriched.append(item_copy)

        return enriched

    @classmethod
    def find_same_active_ingredient_peers(cls, set_id, active_ingredient, generic_name=None, limit=10):
        """
        Finds other labelings in the database with the same active ingredient or generic name.
        """
        peers = []
        target_term = active_ingredient or generic_name
        if not target_term:
            return peers

        target_term = target_term.strip().lower()

        try:
            # Query DrugLabel / sum_spl
            query = db.session.query(
                DrugLabel.set_id,
                DrugLabel.product_names,
                DrugLabel.generic_names,
                DrugLabel.active_ingredients,
                DrugLabel.manufacturer,
                DrugLabel.effective_time_raw,
                DrugLabel.dosage_forms,
                DrugLabel.is_rld
            ).filter(
                DrugLabel.set_id != set_id
            )

            if active_ingredient:
                query = query.filter(
                    func.lower(DrugLabel.active_ingredients).contains(target_term)
                )
            elif generic_name:
                query = query.filter(
                    func.lower(DrugLabel.generic_names).contains(target_term)
                )

            records = query.order_by(DrugLabel.effective_time_raw.desc()).limit(limit).all()

            # Check which peers already have cached PV profile
            peer_set_ids = [r.set_id for r in records]
            cached_profiles = set()
            if peer_set_ids:
                cached_rows = db.session.query(LabelPvProfile.set_id).filter(
                    LabelPvProfile.set_id.in_(peer_set_ids)
                ).all()
                cached_profiles = set([c.set_id for c in cached_rows])

            for idx, r in enumerate(records):
                peers.append({
                    'index': idx + 1,
                    'set_id': r.set_id,
                    'brand_name': r.product_names or 'N/A',
                    'generic_name': r.generic_names or 'N/A',
                    'active_ingredient': r.active_ingredients or 'N/A',
                    'manufacturer_name': r.manufacturer or 'N/A',
                    'effective_time': str(r.effective_time_raw) if r.effective_time_raw else None,
                    'dosage_form': r.dosage_forms,
                    'is_rld': bool(r.is_rld),
                    'has_cached_profile': r.set_id in cached_profiles
                })
        except Exception as e:
            logger.error(f"Error querying peer labels for active ingredient {target_term}: {e}")

        return peers

    @classmethod
    def get_or_generate_profile(cls, set_id, spl_id=None, force_refresh=False, auto_generate=False, user=None):
        """
        Main entrypoint: retrieves cached PV profile from database, or if not yet generated,
        returns not_generated status (unless auto_generate=True or force_refresh=True).
        """
        # 1. Check cache if not force_refresh
        if not force_refresh:
            try:
                cached = db.session.query(LabelPvProfile).filter_by(set_id=set_id).first()
                if cached and cached.profile_data:
                    data = json.loads(cached.profile_data)
                    data['has_record'] = True
                    data['cached'] = True
                    data['cached_at'] = cached.created_at.isoformat() if cached.created_at else None
                    # Update peer list dynamically
                    data['peers'] = cls.find_same_active_ingredient_peers(
                        set_id=set_id,
                        active_ingredient=cached.active_ingredient,
                        generic_name=cached.generic_name
                    )
                    return data
            except Exception as e:
                logger.error(f"Error reading PV profile cache for {set_id}: {e}")

        # 2. Retrieve metadata from DrugLabel
        meta_record = db.session.query(DrugLabel).filter_by(set_id=set_id).first()
        brand_name = meta_record.product_names if meta_record else ''
        generic_name = meta_record.generic_names if meta_record else ''
        active_ingredient = meta_record.active_ingredients if meta_record else ''
        manufacturer = meta_record.manufacturer if meta_record else ''
        effective_time = str(meta_record.effective_time_raw) if meta_record and meta_record.effective_time_raw else None

        peers = cls.find_same_active_ingredient_peers(
            set_id=set_id,
            active_ingredient=active_ingredient,
            generic_name=generic_name
        )

        # If not cached and not requested to generate, return "no record" status
        if not force_refresh and not auto_generate:
            return {
                'set_id': set_id,
                'spl_id': spl_id,
                'brand_name': brand_name,
                'generic_name': generic_name,
                'active_ingredient': active_ingredient,
                'manufacturer_name': manufacturer,
                'effective_time': effective_time,
                'has_record': False,
                'status': 'not_generated',
                'message': 'No PV-Profile has been generated for this labeling yet. Click Generate to start analysis.',
                'cached': False,
                'total_adverse_events': 0,
                'severity_tier_defs': SEVERITY_TIERS,
                'tier_summary': {1: 0, 2: 0, 3: 0, 4: 0, 5: 0},
                'soc_summary': [],
                'items': [],
                'harvested_sections': [],
                'peers': peers
            }

        # 3. Resolve XML from SPL storage / database
        xml_content, source = FDALabelDBService.resolve_spl_xml(set_id, spl_id=spl_id)
        if not xml_content:
            return {'error': 'Label XML not found in local repository'}, 404

        # 4. Harvest Safety Sections
        harvest_result = cls.harvest_safety_sections(xml_content)
        label_format = harvest_result['format']
        sections = harvest_result['sections']

        # If no recognizable safety sections are found, gracefully return unsupported status
        if not sections:
            peers = cls.find_same_active_ingredient_peers(
                set_id=set_id,
                active_ingredient=active_ingredient,
                generic_name=generic_name
            )
            return {
                'set_id': set_id,
                'spl_id': spl_id,
                'brand_name': brand_name,
                'generic_name': generic_name,
                'active_ingredient': active_ingredient,
                'manufacturer_name': manufacturer,
                'effective_time': effective_time,
                'label_format': label_format,
                'is_supported': False,
                'status': 'no_safety_sections_found',
                'message': 'No standard safety or adverse reaction sections (Boxed Warning, Warnings, Adverse Reactions, or OTC Drug Facts) were found in this labeling.',
                'generated_at': datetime.utcnow().isoformat() + 'Z',
                'cached': False,
                'total_adverse_events': 0,
                'severity_tier_defs': SEVERITY_TIERS,
                'tier_summary': {1: 0, 2: 0, 3: 0, 4: 0, 5: 0},
                'soc_summary': [],
                'items': [],
                'harvested_sections': [],
                'peers': peers
            }

        # 5. Extract with AI
        extracted_items = cls.extract_pv_with_ai(label_format, sections, user=user)

        # 6. Enrich with MedDRA PT and SOC
        enriched_items = cls.enrich_with_meddra(extracted_items)

        # 7. Aggregate Summaries
        # A. By Severity Tier
        tier_counts = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
        for it in enriched_items:
            t = it.get('severity_tier', 4)
            tier_counts[t] = tier_counts.get(t, 0) + 1

        # B. By SOC
        soc_map = {}
        for it in enriched_items:
            soc = it.get('soc_name') or 'General / Unclassified'
            if soc not in soc_map:
                soc_map[soc] = {
                    'soc_name': soc,
                    'soc_code': it.get('soc_code'),
                    'count': 0,
                    'max_severity_tier': 5,
                    'items': []
                }
            soc_map[soc]['count'] += 1
            soc_map[soc]['items'].append(it)
            if it.get('severity_tier', 5) < soc_map[soc]['max_severity_tier']:
                soc_map[soc]['max_severity_tier'] = it.get('severity_tier', 5)

        soc_summary = sorted(list(soc_map.values()), key=lambda x: (x['max_severity_tier'], -x['count']))

        # 8. Query Same-Ingredient Peers
        peers = cls.find_same_active_ingredient_peers(
            set_id=set_id,
            active_ingredient=active_ingredient,
            generic_name=generic_name
        )

        # Build response payload
        profile_payload = {
            'set_id': set_id,
            'spl_id': spl_id,
            'brand_name': brand_name,
            'generic_name': generic_name,
            'active_ingredient': active_ingredient,
            'manufacturer_name': manufacturer,
            'effective_time': effective_time,
            'label_format': label_format,
            'generated_at': datetime.utcnow().isoformat() + 'Z',
            'cached': False,
            'total_adverse_events': len(enriched_items),
            'severity_tier_defs': SEVERITY_TIERS,
            'tier_summary': tier_counts,
            'soc_summary': soc_summary,
            'items': enriched_items,
            'harvested_sections': [
                {'code': s['code'], 'title': s['title'], 'severity_tier': s['severity_tier']}
                for s in sections
            ],
            'peers': peers
        }

        # 9. Save / Upsert to Database Cache
        try:
            cached_entry = db.session.query(LabelPvProfile).filter_by(set_id=set_id).first()
            if cached_entry:
                cached_entry.spl_id = spl_id
                cached_entry.brand_name = brand_name
                cached_entry.generic_name = generic_name
                cached_entry.active_ingredient = active_ingredient
                cached_entry.label_format = label_format
                cached_entry.profile_data = json.dumps(profile_payload)
                cached_entry.updated_at = datetime.utcnow()
            else:
                cached_entry = LabelPvProfile(
                    set_id=set_id,
                    spl_id=spl_id,
                    brand_name=brand_name,
                    generic_name=generic_name,
                    active_ingredient=active_ingredient,
                    label_format=label_format,
                    profile_data=json.dumps(profile_payload)
                )
                db.session.add(cached_entry)
            db.session.commit()
        except Exception as e:
            logger.error(f"Failed to save PV profile cache for {set_id}: {e}")
            db.session.rollback()

        return profile_payload
