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
from datetime import datetime, timezone
try:
    import defusedxml.ElementTree as ET
except ImportError:
    import xml.etree.ElementTree as ET

from sqlalchemy import func
from database import db, DrugLabel, MeddraPT, MeddraLLT, MeddraSOC, MeddraMDHIER, LabelPvProfile, LabelPvFeedback
from dashboard.services.fdalabel_db import FDALabelDBService
from dashboard.services.ai_handler import call_llm
from dashboard.services.xml_handler import identify_label_format, get_local_name
from dashboard.services.meddra_matcher import scan_label_for_meddra

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
2. "meddra_pt_candidate": Standardized MedDRA Preferred Term (PT) in clinical English. For non-standard or colloquial phrases (e.g., "upset stomach" -> "Dyspepsia", "feel faint" -> "Syncope", "liver injury" -> "Hepatotoxicity"), map them to the proper MedDRA PT while preserving the original raw wording in "term".
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

GUIDANCE ON DETECTED CANDIDATE KEYWORDS:
Review all candidate MedDRA keywords detected in each section. Include all true adverse events, side effects, and clinical safety warnings. Exclude terms only if they are merely descriptive background text (e.g. primary disease indications, inclusion/exclusion criteria, normal laboratory reference ranges) rather than true drug-associated adverse reactions.

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
                        
                        # Pre-scan section for MedDRA dictionary matches
                        detected_terms = []
                        try:
                            detected_terms = scan_label_for_meddra(text_content) or []
                        except Exception as e:
                            logger.error(f"Error scanning MedDRA terms for section {section_name}: {e}")

                        sections.append({
                            'code': code_val,
                            'title': section_name or f"Tier {tier} Safety Section",
                            'severity_tier': tier,
                            'text': text_content[:15000], # Cap long sections to 15k chars
                            'detected_meddra_terms': detected_terms
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
            hints_str = ""
            if s.get('detected_meddra_terms'):
                hints_str = f"Candidate MedDRA keywords detected in text: {', '.join(s['detected_meddra_terms'][:40])}\n"
            prompt_parts.append(
                f"--- SECTION: {s['title']} (LOINC: {s['code']}, Severity Tier: {s['severity_tier']}) ---\n"
                f"{hints_str}"
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
            raw_key = (item.get('term') or '').strip().lower()

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

            # Non-standard / mapped term flag: True if original raw term is different from standardized PT
            is_mapped = bool(raw_key and item_copy['meddra_pt'].lower() != raw_key)
            item_copy['is_mapped'] = is_mapped

            enriched.append(item_copy)

        return enriched

    @classmethod
    def consolidate_items_and_harvest_occurrences(cls, items, sections):
        """
        Consolidates duplicate mentions of the same MedDRA PT into a single canonical row,
        and harvests all occurrences/quotes across sections in natural chronological order.
        """
        if not items:
            return []

        # Group items by standardized PT
        grouped = {}
        for item in items:
            pt_key = (item.get('meddra_pt') or item.get('term') or '').strip().lower()
            if not pt_key:
                continue
            if pt_key not in grouped:
                grouped[pt_key] = []
            grouped[pt_key].append(item)

        consolidated = []
        for pt_key, group in grouped.items():
            # 1. Pick the mention with the highest severity (min severity_tier number)
            # and richest quantitative data
            sorted_by_tier = sorted(group, key=lambda x: (x.get('severity_tier', 4), -(x.get('drug_max_pct') or x.get('drug_min_pct') or -1)))
            primary = sorted_by_tier[0]

            # Determine best quantitative rate across all mentions
            quant_item = next((x for x in group if x.get('is_quantitative') and (x.get('drug_max_pct') is not None or x.get('drug_min_pct') is not None)), None)

            drug_min = quant_item['drug_min_pct'] if quant_item else primary.get('drug_min_pct')
            drug_max = quant_item['drug_max_pct'] if quant_item else primary.get('drug_max_pct')
            drug_freq_text = quant_item['drug_frequency_text'] if quant_item else primary.get('drug_frequency_text')
            placebo_pct = quant_item['placebo_pct'] if quant_item else primary.get('placebo_pct')
            placebo_freq_text = quant_item['placebo_frequency_text'] if quant_item else primary.get('placebo_frequency_text')
            risk_diff = quant_item['risk_difference_pct'] if quant_item else primary.get('risk_difference_pct')
            freq_cat = quant_item['frequency_category'] if quant_item else primary.get('frequency_category', 'not_quantified')

            is_manual = any(x.get('is_manual_adjusted') for x in group)
            is_mapped = any(x.get('is_mapped') for x in group)

            # Collect search terms for regex lookup: all raw terms and standard PT
            candidate_terms = list(set([x.get('term') for x in group if x.get('term')] + [primary['meddra_pt']]))

            # 2. Harvest all occurrences in chronological section order
            occurrences = []
            seen_excerpts = set()

            # First, add any specific excerpts extracted by AI/user
            for m in sorted_by_tier:
                ex = (m.get('excerpt') or '').strip()
                if ex and len(ex) > 10 and ex.lower() not in seen_excerpts:
                    seen_excerpts.add(ex.lower())
                    occurrences.append({
                        'tier': m.get('severity_tier', 4),
                        'section_title': m.get('section_name') or 'Safety Section',
                        'excerpt': ex,
                        'drug_pct': m.get('drug_max_pct') or m.get('drug_min_pct')
                    })

            # Next, scan full harvested sections in natural order
            for sec in sections:
                sec_text = sec.get('text', '')
                sec_tier = sec.get('severity_tier', 4)
                sec_title = sec.get('title', 'Safety Section')

                sentences = re.split(r'(?<=[.!?\n])\s+', sec_text)
                sec_quote_count = 0

                for s in sentences:
                    clean_s = s.strip()
                    if len(clean_s) < 15 or len(clean_s) > 350:
                        continue

                    # Check if any candidate term matches word boundary
                    for t in candidate_terms:
                        if re.search(r'\b' + re.escape(t) + r'\b', clean_s, re.IGNORECASE):
                            if clean_s.lower() not in seen_excerpts:
                                seen_excerpts.add(clean_s.lower())
                                occurrences.append({
                                    'tier': sec_tier,
                                    'section_title': sec_title,
                                    'excerpt': clean_s,
                                    'drug_pct': None
                                })
                                sec_quote_count += 1
                                if sec_quote_count >= 2: # Max 2 per section
                                    break
                            break
                    if sec_quote_count >= 2:
                        break

            # Sort occurrences by tier (or section index)
            occurrences.sort(key=lambda o: (o['tier'], o['section_title']))

            # Extract distinct sections present
            sections_present = []
            seen_present = set()
            for o in occurrences:
                k = (o['tier'], o['section_title'])
                if k not in seen_present:
                    seen_present.add(k)
                    sections_present.append({'tier': o['tier'], 'title': o['section_title']})

            # Best primary excerpt
            best_excerpt = occurrences[0]['excerpt'] if occurrences else (primary.get('excerpt') or 'Reported in safety labeling')

            consolidated.append({
                'term': primary.get('term') or primary['meddra_pt'],
                'meddra_pt': primary['meddra_pt'],
                'meddra_pt_code': primary.get('meddra_pt_code'),
                'soc_name': primary.get('soc_name', 'General disorders and administration site conditions'),
                'soc_code': primary.get('soc_code'),
                'severity_tier': primary.get('severity_tier', 4),
                'section_name': primary.get('section_name', 'Safety Section'),
                'is_quantitative': bool(drug_min is not None or drug_max is not None),
                'drug_min_pct': drug_min,
                'drug_max_pct': drug_max,
                'drug_frequency_text': drug_freq_text,
                'placebo_pct': placebo_pct,
                'placebo_frequency_text': placebo_freq_text,
                'risk_difference_pct': risk_diff,
                'frequency_category': freq_cat,
                'excerpt': best_excerpt,
                'is_mapped': is_mapped,
                'is_manual_adjusted': is_manual,
                'sections_present': sections_present,
                'occurrences': occurrences
            })

        return consolidated

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
    def classify_frequency(cls, pct):
        """
        Classifies frequency percentage into CIOMS/SIDER categories:
        - >= 10%: very_common
        - 1% to 10%: common
        - 0.1% to 1%: uncommon
        - 0.01% to 0.1%: rare
        - < 0.01%: very_rare
        """
        if pct is None:
            return 'not_quantified'
        try:
            val = float(pct)
            if val >= 10.0:
                return 'very_common'
            elif val >= 1.0:
                return 'common'
            elif val >= 0.1:
                return 'uncommon'
            elif val >= 0.01:
                return 'rare'
            else:
                return 'very_rare'
        except (ValueError, TypeError):
            return 'not_quantified'

    @classmethod
    def record_feedback(cls, set_id, term, feedback_type, spl_id=None, meddra_pt=None, soc_name=None, section_name=None, comment=None, user=None):
        """
        Records or toggles user feedback for a term:
        - 'is_ae': Leftover term reported by user as a real adverse event
        - 'not_ae': Main table AE reported by user as NOT an adverse event
        """
        if not set_id or not term or not feedback_type:
            return {'error': 'set_id, term, and feedback_type are required'}, 400

        user_id = user.id if user and hasattr(user, 'id') else None

        try:
            # Check if existing feedback already exists for this term & feedback_type
            existing = db.session.query(LabelPvFeedback).filter_by(
                set_id=set_id,
                term=term,
                feedback_type=feedback_type
            ).first()

            if existing:
                # If existing, remove it (toggle off)
                db.session.delete(existing)
                db.session.commit()
                return {
                    'success': True,
                    'action': 'removed',
                    'term': term,
                    'feedback_type': feedback_type,
                    'message': f"Tag '{feedback_type}' removed for '{term}'"
                }
            else:
                # Insert new feedback record
                feedback = LabelPvFeedback(
                    set_id=set_id,
                    spl_id=spl_id,
                    user_id=user_id,
                    term=term,
                    meddra_pt=meddra_pt,
                    soc_name=soc_name,
                    section_name=section_name,
                    feedback_type=feedback_type,
                    comment=comment,
                    status='pending'
                )
                db.session.add(feedback)
                db.session.commit()
                return {
                    'success': True,
                    'action': 'tagged',
                    'term': term,
                    'feedback_type': feedback_type,
                    'message': f"Term '{term}' successfully tagged as '{feedback_type}'"
                }
        except Exception as e:
            logger.error(f"Error recording PV feedback for {set_id} term {term}: {e}")
            db.session.rollback()
            return {'error': str(e)}, 500

    @classmethod
    def get_feedbacks(cls, set_id):
        """
        Retrieves all user feedback tags recorded for a given set_id.
        Returns a dict mapped by term.lower() -> list of feedback info.
        """
        feedbacks_map = {}
        try:
            records = db.session.query(LabelPvFeedback).filter_by(set_id=set_id).all()
            for r in records:
                term_key = r.term.strip().lower()
                if term_key not in feedbacks_map:
                    feedbacks_map[term_key] = []
                feedbacks_map[term_key].append({
                    'id': r.id,
                    'term': r.term,
                    'meddra_pt': r.meddra_pt,
                    'feedback_type': r.feedback_type,
                    'comment': r.comment,
                    'status': r.status,
                    'created_at': r.created_at.isoformat() if r.created_at else None
                })
        except Exception as e:
            logger.error(f"Error querying PV feedbacks for {set_id}: {e}")

        return feedbacks_map

    @classmethod
    def update_profile_with_tags(cls, set_id, approved_terms=None, spl_id=None, user=None):
        """
        Admin/Developer Action: Updates the PV Profile by incorporating reviewer-tagged terms:
        - For 'is_ae' terms in approved_terms: Extracts their exact source sentence/excerpt from
          the safety sections, standardizes to MedDRA PT/SOC, and inserts them with
          is_manual_adjusted=True.
        - For 'not_ae' terms: Removes matching items from the profile.
        - Recalculates summaries and saves back to cache.
        """
        try:
            # 1. Load cached profile
            cached_row = db.session.query(LabelPvProfile).filter_by(set_id=set_id).first()
            if not cached_row or not cached_row.profile_data:
                return {'error': 'No existing PV Profile found to update. Generate profile first.'}, 404

            profile_data = json.loads(cached_row.profile_data)
            existing_items = profile_data.get('items', [])
            leftover_terms = profile_data.get('leftover_terms', [])

            # 2. Get user feedbacks
            feedbacks_map = cls.get_feedbacks(set_id)

            # Determine approved terms to add
            approved_set = set(t.strip().lower() for t in (approved_terms or []))

            # Fetch XML for text extraction
            xml_str, _ = FDALabelDBService.resolve_spl_xml(set_id=set_id, spl_id=spl_id)
            harvested = cls.harvest_safety_sections(xml_str) if xml_str else {'sections': []}
            sections = harvested.get('sections', [])

            # 3. Process 'is_ae' terms
            added_terms_lower = set()
            for term_key, fb_list in feedbacks_map.items():
                if not fb_list:
                    continue
                latest_fb = fb_list[-1]
                if latest_fb.get('feedback_type') != 'is_ae':
                    continue

                term_raw = latest_fb.get('term', term_key)
                if approved_terms is not None and term_raw.strip().lower() not in approved_set:
                    continue

                # Standardize to MedDRA PT & SOC
                pt_row = db.session.query(MeddraPT).filter(func.lower(MeddraPT.pt_name) == term_raw.strip().lower()).first()
                if not pt_row:
                    llt_row = db.session.query(MeddraLLT).filter(func.lower(MeddraLLT.llt_name) == term_raw.strip().lower()).first()
                    if llt_row and llt_row.pt_code:
                        pt_row = db.session.query(MeddraPT).filter_by(pt_code=llt_row.pt_code).first()

                if pt_row:
                    meddra_pt = pt_row.pt_name
                    pt_code = pt_row.pt_code
                    mdhier = db.session.query(MeddraMDHIER).filter_by(pt_code=pt_row.pt_code).first()
                    soc_name = 'General disorders and administration site conditions'
                    soc_code = 10018065
                    if mdhier and mdhier.soc_code:
                        soc_rec = db.session.query(MeddraSOC).filter_by(soc_code=mdhier.soc_code).first()
                        if soc_rec:
                            soc_name = soc_rec.soc_name
                            soc_code = soc_rec.soc_code
                else:
                    meddra_pt = term_raw
                    pt_code = None
                    soc_name = 'General disorders and administration site conditions'
                    soc_code = None

                # Search sections for exact text quote & section metadata
                found_section_title = 'Safety Section'
                found_tier = 4 # default to adverse reactions tier
                found_excerpt = f"Mentioned as {term_raw} in labeling text."
                drug_pct = None
                placebo_pct = None

                for sec in sections:
                    sec_text = sec.get('text', '')
                    if re.search(r'\b' + re.escape(term_raw) + r'\b', sec_text, re.IGNORECASE):
                        found_section_title = sec.get('title', 'Safety Section')
                        found_tier = sec.get('severity_tier', 4)

                        # Extract surrounding sentence
                        sentences = re.split(r'(?<=[.!?\n])\s+', sec_text)
                        for s in sentences:
                            if re.search(r'\b' + re.escape(term_raw) + r'\b', s, re.IGNORECASE):
                                clean_s = s.strip()
                                if len(clean_s) > 200:
                                    # Truncate to reasonable quote
                                    m = re.search(r'\b' + re.escape(term_raw) + r'\b', clean_s, re.IGNORECASE)
                                    if m:
                                        start = max(0, m.start() - 60)
                                        end = min(len(clean_s), m.end() + 60)
                                        clean_s = ('...' if start > 0 else '') + clean_s[start:end] + ('...' if end < len(clean_s) else '')
                                found_excerpt = clean_s
                                # Look for percentage in sentence
                                pct_matches = re.findall(r'(\d+(?:\.\d+)?)\s*%', s)
                                if pct_matches:
                                    try:
                                        drug_pct = float(pct_matches[0])
                                    except ValueError:
                                        pass
                                break
                        break

                is_quant = drug_pct is not None
                is_mapped = bool(term_raw.strip().lower() != meddra_pt.strip().lower())

                new_item = {
                    'term': term_raw,
                    'meddra_pt': meddra_pt,
                    'meddra_pt_code': pt_code,
                    'soc_name': soc_name,
                    'soc_code': soc_code,
                    'severity_tier': found_tier,
                    'section_name': found_section_title,
                    'is_quantitative': is_quant,
                    'drug_min_pct': drug_pct,
                    'drug_max_pct': drug_pct,
                    'drug_frequency_text': f"{drug_pct}%" if drug_pct is not None else None,
                    'placebo_pct': placebo_pct,
                    'placebo_frequency_text': None,
                    'risk_difference_pct': None,
                    'frequency_category': cls.classify_frequency(drug_pct) if drug_pct is not None else 'not_quantified',
                    'excerpt': found_excerpt,
                    'is_mapped': is_mapped,
                    'is_manual_adjusted': True
                }

                # Check if item already exists in existing_items; if so update it, else append
                matched_idx = -1
                for idx, ex_item in enumerate(existing_items):
                    if ex_item.get('meddra_pt', '').lower() == meddra_pt.lower() or ex_item.get('term', '').lower() == term_raw.lower():
                        matched_idx = idx
                        break

                if matched_idx >= 0:
                    existing_items[matched_idx].update(new_item)
                else:
                    existing_items.append(new_item)

                added_terms_lower.add(term_raw.strip().lower())
                added_terms_lower.add(meddra_pt.strip().lower())

            # 4. Process 'not_ae' terms: filter out from existing_items
            not_ae_terms = set()
            for term_key, fb_list in feedbacks_map.items():
                if fb_list and fb_list[-1].get('feedback_type') == 'not_ae':
                    not_ae_terms.add(term_key)
                    not_ae_terms.add(fb_list[-1].get('term', '').strip().lower())

            if not_ae_terms:
                existing_items = [
                    it for it in existing_items
                    if it.get('term', '').strip().lower() not in not_ae_terms
                    and it.get('meddra_pt', '').strip().lower() not in not_ae_terms
                ]

            # 5. Remove newly added terms from leftover_terms
            if leftover_terms and added_terms_lower:
                leftover_terms = [
                    lt for lt in leftover_terms
                    if lt.get('term', '').strip().lower() not in added_terms_lower
                    and lt.get('meddra_pt', '').strip().lower() not in added_terms_lower
                ]

            # 5.5 Consolidate duplicate MedDRA PT mentions across sections and harvest all chronological occurrences
            existing_items = cls.consolidate_items_and_harvest_occurrences(existing_items, sections)

            # 6. Recalculate Tier & SOC Summaries
            tier_counts = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
            for it in existing_items:
                t = it.get('severity_tier', 4)
                tier_counts[t] = tier_counts.get(t, 0) + 1

            soc_dict = {}
            for it in existing_items:
                s_name = it.get('soc_name', 'General disorders and administration site conditions')
                if s_name not in soc_dict:
                    soc_dict[s_name] = {
                        'soc_name': s_name,
                        'soc_code': it.get('soc_code'),
                        'count': 0,
                        'max_severity_tier': it.get('severity_tier', 4)
                    }
                soc_dict[s_name]['count'] += 1
                if it.get('severity_tier', 4) < soc_dict[s_name]['max_severity_tier']:
                    soc_dict[s_name]['max_severity_tier'] = it.get('severity_tier', 4)

            soc_summary = sorted(soc_dict.values(), key=lambda x: (x['max_severity_tier'], -x['count']))
            chart_data = [
                {
                    'soc_name': s['soc_name'],
                    'count': s['count'],
                    'max_severity_tier': s['max_severity_tier']
                }
                for s in soc_summary
            ]

            # Sort items by severity tier, then risk difference / frequency
            existing_items.sort(
                key=lambda x: (
                    x.get('severity_tier', 4),
                    -(x.get('risk_difference_pct') or -999),
                    -(x.get('drug_max_pct') or x.get('drug_min_pct') or -999),
                    x.get('meddra_pt', '')
                )
            )

            # Update profile_data
            profile_data['items'] = existing_items
            profile_data['leftover_terms'] = leftover_terms
            profile_data['total_adverse_events'] = len(existing_items)
            profile_data['total_leftover_terms'] = len(leftover_terms)
            profile_data['tier_summary'] = tier_counts
            profile_data['soc_summary'] = soc_summary
            profile_data['chart_data'] = chart_data
            profile_data['feedbacks'] = cls.get_feedbacks(set_id)
            profile_data['updated_at'] = datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + 'Z'

            # 7. Update database cache
            cached_row.profile_data = json.dumps(profile_data)

            # 8. Mark applied feedback status in database
            db.session.query(LabelPvFeedback).filter(
                LabelPvFeedback.set_id == set_id,
                LabelPvFeedback.term.in_(list(added_terms_lower) + list(not_ae_terms))
            ).update({'status': 'applied'}, synchronize_session=False)

            db.session.commit()

            return profile_data
        except Exception as e:
            logger.exception(f"Error updating PV Profile with tags for {set_id}: {e}")
            db.session.rollback()
            return {'error': str(e)}, 500

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
                    # Attach live feedback tags
                    data['feedbacks'] = cls.get_feedbacks(set_id)
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
                'generated_at': datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + 'Z',
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

        # 6.5 Consolidate duplicate MedDRA PT mentions across sections and harvest all chronological occurrences
        enriched_items = cls.consolidate_items_and_harvest_occurrences(enriched_items, sections)

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

        # 8. Compute Leftover MedDRA Dictionary Matches
        # (Terms detected in raw text scan that were NOT included as clinical AEs by AI)
        dict_hit_map = {}
        for s in sections:
            sec_title = s.get('title', 'Safety Section')
            for term in s.get('detected_meddra_terms', []):
                t_str = str(term).strip()
                if t_str and t_str.lower() not in dict_hit_map:
                    dict_hit_map[t_str.lower()] = (t_str, sec_title)

        extracted_keys = set()
        for it in enriched_items:
            if it.get('term'): extracted_keys.add(it['term'].strip().lower())
            if it.get('meddra_pt'): extracted_keys.add(it['meddra_pt'].strip().lower())

        leftover_raw = []
        for t_lower, (t_orig, sec_title) in dict_hit_map.items():
            if t_lower not in extracted_keys:
                leftover_raw.append({
                    'term': t_orig,
                    'meddra_pt': t_orig,
                    'section_name': sec_title,
                    'severity_tier': 5,
                    'is_quantitative': False
                })

        # Enrich leftovers with MedDRA SOC
        leftover_enriched = cls.enrich_with_meddra(leftover_raw) if leftover_raw else []

        leftover_terms = []
        for l in leftover_enriched:
            leftover_terms.append({
                'term': l['term'],
                'meddra_pt': l.get('meddra_pt') or l['term'],
                'meddra_pt_code': l.get('meddra_pt_code'),
                'soc_name': l.get('soc_name') or 'General / Unclassified disorders',
                'soc_code': l.get('soc_code'),
                'section_name': l.get('section_name') or 'Safety Section',
                'status': 'Contextual Mention / Excluded',
                'reason': 'Mentioned in label text but evaluated as background context, disease indication, or non-AE description by clinical AI'
            })

        leftover_terms.sort(key=lambda x: (x['soc_name'], x['term']))

        # Chart Data for Top SOCs
        chart_data = [
            {
                'soc_name': soc['soc_name'],
                'count': soc['count'],
                'max_severity_tier': soc['max_severity_tier']
            }
            for soc in soc_summary
        ]

        # 9. Query Same-Ingredient Peers
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
            'generated_at': datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + 'Z',
            'cached': False,
            'total_adverse_events': len(enriched_items),
            'severity_tier_defs': SEVERITY_TIERS,
            'tier_summary': tier_counts,
            'soc_summary': soc_summary,
            'chart_data': chart_data,
            'items': enriched_items,
            'leftover_terms': leftover_terms,
            'total_leftover_terms': len(leftover_terms),
            'feedbacks': cls.get_feedbacks(set_id),
            'harvested_sections': [
                {'code': s['code'], 'title': s['title'], 'severity_tier': s['severity_tier']}
                for s in sections
            ],
            'peers': peers
        }

        # 10. Save / Upsert to Database Cache
        try:
            cached_entry = db.session.query(LabelPvProfile).filter_by(set_id=set_id).first()
            if cached_entry:
                cached_entry.spl_id = spl_id
                cached_entry.brand_name = brand_name
                cached_entry.generic_name = generic_name
                cached_entry.active_ingredient = active_ingredient
                cached_entry.label_format = label_format
                cached_entry.profile_data = json.dumps(profile_payload)
                cached_entry.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
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
