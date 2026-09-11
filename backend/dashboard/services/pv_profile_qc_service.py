"""
PV-Profile QC Service (Quality Control Agents for Pharmacovigilance Profile)

Inspired by multi-agent extraction & QC workflows:
1. QC Agent 1: Adverse Event Term Extraction & Ignored Terms Auditor
   - Critically verifies if each extracted term is a genuine Adverse Drug Reaction (ADR)
     vs false positive (indication, preexisting condition, baseline trait, PK parameter).
   - Audits excluded candidate leftover terms to identify any mistakenly ignored AEs.
   - Flags clinically borderline / ambiguous terms for reviewer manual check.

2. QC Agent 2: Citation & Context Grounding Auditor
   - Verifies whether each extracted AE's quote / excerpt actually exists in the label text
     and accurately supports the adverse reaction determination without contradictory context.

3. QC Synthesizer & Persistence
   - Synthesizes findings into item-level flags and attaches QC metadata to the cached profile in PostgreSQL.
"""

import json
import logging
import re
from datetime import datetime, timezone

from database import db, LabelPvProfile
from dashboard.services.fdalabel_db import FDALabelDBService
from dashboard.services.ai_handler import call_llm
from dashboard.services.pv_profile_service import PVProfileService

logger = logging.getLogger(__name__)

TERM_QC_SYSTEM_PROMPT = """You are an independent Senior Pharmacovigilance Quality Control (QC) Auditor.
Your job is to independently verify whether adverse event terms extracted from an FDA drug label are genuine Adverse Drug Reactions (ADRs) vs false positives, and whether any candidate terms that were excluded/ignored should have been included.

Definitions:
- Valid AE (is_valid_ae = true): A noxious or unintended response occurring during drug therapy (e.g., headache, nausea, elevated ALT, rhabdomyolysis, rash, myocardial infarction, Stevens-Johnson syndrome).
- Invalid / Non-AE (is_valid_ae = false): An indication (the disease the drug treats), preexisting risk factor / comorbidity (e.g., history of cardiovascular disease, elderly age, baseline renal impairment), normal physiological effect without harm, pharmacokinetic parameter (e.g., clearance, CYP substrate), or premedication requirement.
- Ambiguous AE (is_ambiguous = true): Borderline causality or clinical context (e.g. mentioned in Warnings as a possible symptom of underlying disease, paradoxical reaction, or precautionary warning where drug causality is uncertain or debated).

Output strictly valid JSON with this schema:
{
  "evaluated_terms": [
    {
      "term": "exact term string provided",
      "is_valid_ae": true or false,
      "is_ambiguous": true or false,
      "qc_note": "Brief justification (1-2 sentences) explaining why it is valid, invalid, or ambiguous."
    }
  ],
  "evaluated_leftovers": [
    {
      "term": "exact candidate term string provided",
      "should_be_ae": true or false,
      "is_ambiguous": true or false,
      "qc_note": "Brief justification explaining if it was mistakenly ignored or if exclusion is ambiguous."
    }
  ]
}
"""

CITATION_QC_SYSTEM_PROMPT = """You are an independent Regulatory Labeling Evidence & Grounding QC Auditor.
Your task is to verify whether the quotes/excerpts cited for each extracted Adverse Event (AE) term accurately support that the term is reported as an adverse reaction for this drug.

Definitions:
- "accurate": The quote clearly supports the term as an adverse reaction or safety warning associated with the drug.
- "ambiguous": The quote mentions the term, but in an ambiguous, contradictory, or misleading context (e.g., "incidence was identical to placebo", "X was NOT observed", describes an efficacy endpoint, or is an animal study finding).
- "inaccurate": The quote is completely unrelated, hallucinated, or contradicts the term.

Output strictly valid JSON with this schema:
{
  "evaluated_citations": [
    {
      "term": "exact term string provided",
      "citation_status": "accurate" or "ambiguous" or "inaccurate",
      "is_ambiguous": true or false,
      "qc_note": "Brief justification (1-2 sentences) if ambiguous or inaccurate."
    }
  ]
}
"""


def _extract_json_safely(ai_response):
    """Safely extracts and parses JSON from AI response."""
    if not ai_response:
        return None

    pattern = r'```(?:json)?\s*([\s\S]*?)\s*```'
    matches = re.findall(pattern, ai_response, re.IGNORECASE)
    for match in matches:
        candidate = match.strip()
        try:
            return json.loads(candidate)
        except Exception:
            try:
                cleaned = re.sub(r',\s*([}\]])', r'\1', candidate)
                return json.loads(cleaned)
            except Exception:
                pass

    try:
        start_idx = ai_response.find('{')
        end_idx = ai_response.rfind('}')
        if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
            candidate = ai_response[start_idx:end_idx + 1].strip()
            return json.loads(candidate)
    except Exception:
        pass

    return None


class PVProfileQCService:

    @classmethod
    def run_qc(cls, set_id, spl_id=None, user=None):
        """
        Executes the two-agent QC workflow on an existing PV Profile:
        1. QC Agent 1: Term Extraction & Ignored Terms Validation
        2. QC Agent 2: Citation & Context Grounding
        3. Synthesizes item-level flags and updates database cache.
        """
        # 1. Fetch cached profile
        cached_row = db.session.query(LabelPvProfile).filter_by(set_id=set_id).first()
        if not cached_row or not cached_row.profile_data:
            return {'error': 'No existing PV Profile found. Please generate the profile before running QC.'}, 404

        try:
            profile_data = json.loads(cached_row.profile_data)
        except Exception as e:
            logger.error(f"Failed to decode profile_data for {set_id}: {e}")
            return {'error': 'Corrupted profile data in database.'}, 500

        items = profile_data.get('items', [])
        leftover_terms = profile_data.get('leftover_terms', [])
        drug_name = profile_data.get('brand_name') or profile_data.get('generic_name') or 'Drug Product'

        if not items and not leftover_terms:
            profile_data['qc'] = {
                'status': 'completed',
                'completed_at': datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + 'Z',
                'total_items_audited': 0,
                'ambiguous_items_count': 0,
                'ambiguous_leftovers_count': 0,
                'summary': 'No adverse event items found in profile to audit.'
            }
            cached_row.profile_data = json.dumps(profile_data)
            db.session.commit()
            return profile_data

        # 2. Retrieve label text sections if needed
        sections = []
        try:
            xml_str, _ = FDALabelDBService.resolve_spl_xml(set_id=set_id, spl_id=spl_id)
            if xml_str:
                harvested = PVProfileService.harvest_safety_sections(xml_str)
                sections = harvested.get('sections', [])
        except Exception as e:
            logger.warning(f"Could not load XML sections for QC {set_id}: {e}")

        # 3. Execute QC Agent 1: Term Extraction & Ignored Terms Validation
        term_qc_results = cls._audit_terms(
            drug_name=drug_name,
            items=items,
            leftover_terms=leftover_terms,
            user=user
        )

        # 4. Execute QC Agent 2: Citation & Context Grounding
        citation_qc_results = cls._audit_citations(
            drug_name=drug_name,
            items=items,
            sections=sections,
            user=user
        )

        # 5. Synthesize QC evaluations into item-level flags
        cls._synthesize(
            items=items,
            leftover_terms=leftover_terms,
            term_qc_results=term_qc_results,
            citation_qc_results=citation_qc_results
        )

        # 6. Assemble profile QC summary block
        ambiguous_items = sum(1 for it in items if it.get('qc', {}).get('is_ambiguous'))
        ambiguous_leftovers = sum(1 for lt in leftover_terms if lt.get('qc', {}).get('is_ambiguous'))

        qc_metadata = {
            'status': 'completed',
            'completed_at': datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + 'Z',
            'total_items_audited': len(items),
            'ambiguous_items_count': ambiguous_items,
            'total_leftovers_audited': len(leftover_terms),
            'ambiguous_leftovers_count': ambiguous_leftovers,
            'summary': f"QC complete: {ambiguous_items} of {len(items)} extracted terms flagged as ambiguous; {ambiguous_leftovers} candidate terms flagged for review."
        }

        profile_data['items'] = items
        profile_data['leftover_terms'] = leftover_terms
        profile_data['qc'] = qc_metadata

        # 7. Persist to PostgreSQL database
        try:
            cached_row.profile_data = json.dumps(profile_data)
            cached_row.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
            db.session.commit()
            logger.info(f"PV Profile QC completed and persisted for {set_id} ({ambiguous_items} ambiguous items).")
        except Exception as e:
            logger.error(f"Failed to persist QC results for {set_id}: {e}")
            db.session.rollback()

        return profile_data

    @classmethod
    def _audit_terms(cls, drug_name, items, leftover_terms, user=None):
        """QC Agent 1: Reviews extracted terms and excluded candidate leftovers."""
        # Prepare compact payload for LLM
        extracted_summary = [
            {
                'term': it.get('term'),
                'meddra_pt': it.get('meddra_pt'),
                'section': it.get('section_name'),
                'severity_tier': it.get('severity_tier')
            }
            for it in items[:60] # Batch limit for token efficiency
        ]

        # Top candidate leftovers (e.g. up to 25 terms)
        leftovers_summary = [
            {
                'term': lt.get('term'),
                'section': lt.get('section_name'),
                'exclusion_reason': lt.get('reason')
            }
            for lt in leftover_terms[:25]
        ]

        user_message = f"""Drug: "{drug_name}"

--- EXTRACTED ADVERSE EVENT TERMS ({len(extracted_summary)}) ---
{json.dumps(extracted_summary, indent=2)}

--- EXCLUDED CANDIDATE TERMS ({len(leftovers_summary)}) ---
{json.dumps(leftovers_summary, indent=2)}

Please audit whether each extracted term is a valid ADR vs false positive/indication, and whether any excluded terms should have been captured. Return strictly valid JSON.
"""

        try:
            raw_response = call_llm(
                user=user,
                system_prompt=TERM_QC_SYSTEM_PROMPT,
                user_message=user_message,
                temperature=0.05,
                max_tokens=8192
            )
            parsed = _extract_json_safely(raw_response)
            if parsed and isinstance(parsed, dict):
                return parsed
        except Exception as e:
            logger.error(f"QC Agent 1 error during term audit for {drug_name}: {e}")

        return {'evaluated_terms': [], 'evaluated_leftovers': []}

    @classmethod
    def _audit_citations(cls, drug_name, items, sections, user=None):
        """QC Agent 2: Verifies quotes and citations for extracted AEs."""
        # Items with excerpts
        citations_summary = []
        for it in items[:50]:
            excerpt = (it.get('excerpt') or '').strip()
            if not excerpt and it.get('occurrences'):
                first_occ = it['occurrences'][0]
                excerpt = first_occ.get('excerpt', '')
            citations_summary.append({
                'term': it.get('term'),
                'meddra_pt': it.get('meddra_pt'),
                'section': it.get('section_name'),
                'cited_excerpt': excerpt[:250] if excerpt else 'No excerpt provided'
            })

        user_message = f"""Drug: "{drug_name}"

--- EXTRACTED TERMS & CITATIONS ({len(citations_summary)}) ---
{json.dumps(citations_summary, indent=2)}

Verify if each citation factually and contextually supports the adverse event determination for this drug.
Return strictly valid JSON.
"""

        try:
            raw_response = call_llm(
                user=user,
                system_prompt=CITATION_QC_SYSTEM_PROMPT,
                user_message=user_message,
                temperature=0.05,
                max_tokens=8192
            )
            parsed = _extract_json_safely(raw_response)
            if parsed and isinstance(parsed, dict):
                return parsed
        except Exception as e:
            logger.error(f"QC Agent 2 error during citation audit for {drug_name}: {e}")

        return {'evaluated_citations': []}

    @classmethod
    def _synthesize(cls, items, leftover_terms, term_qc_results, citation_qc_results):
        """Combines findings from both QC agents into uniform item-level metadata."""
        # Build lookup maps by term and pt (lowercased)
        term_eval_map = {}
        for te in term_qc_results.get('evaluated_terms', []):
            if isinstance(te, dict) and te.get('term'):
                term_eval_map[te['term'].strip().lower()] = te

        citation_eval_map = {}
        for ce in citation_qc_results.get('evaluated_citations', []):
            if isinstance(ce, dict) and ce.get('term'):
                citation_eval_map[ce['term'].strip().lower()] = ce

        leftover_eval_map = {}
        for le in term_qc_results.get('evaluated_leftovers', []):
            if isinstance(le, dict) and le.get('term'):
                leftover_eval_map[le['term'].strip().lower()] = le

        # 1. Synthesize for extracted items
        for it in items:
            term_key = (it.get('term') or '').strip().lower()
            pt_key = (it.get('meddra_pt') or '').strip().lower()

            te = term_eval_map.get(term_key) or term_eval_map.get(pt_key) or {}
            ce = citation_eval_map.get(term_key) or citation_eval_map.get(pt_key) or {}

            is_term_valid = te.get('is_valid_ae', True)
            is_term_ambiguous = te.get('is_ambiguous', False) or (is_term_valid is False)
            term_note = te.get('qc_note', '')

            citation_status = ce.get('citation_status', 'accurate')
            is_citation_ambiguous = ce.get('is_ambiguous', False) or (citation_status in ('ambiguous', 'inaccurate'))
            citation_note = ce.get('qc_note', '')

            # Combined ambiguity
            is_overall_ambiguous = bool(is_term_ambiguous or is_citation_ambiguous)

            flags = []
            if not is_term_valid:
                flags.append('Potential False Positive / Non-AE')
            elif is_term_ambiguous:
                flags.append('Ambiguous AE Determination')

            if citation_status == 'inaccurate':
                flags.append('Inaccurate Citation')
            elif citation_status == 'ambiguous':
                flags.append('Ambiguous Evidence Context')

            # Build concise clinical note
            notes = []
            if term_note:
                notes.append(f"Term QC: {term_note}")
            if citation_note and citation_note != term_note:
                notes.append(f"Citation QC: {citation_note}")

            full_note = " | ".join(notes) if notes else ("Ambiguous clinical context requires review." if is_overall_ambiguous else "QC Verified")

            it['qc'] = {
                'is_ambiguous': is_overall_ambiguous,
                'term_valid': is_term_valid,
                'citation_valid': citation_status == 'accurate',
                'citation_status': citation_status,
                'flags': flags,
                'note': full_note
            }

        # 2. Synthesize for leftover excluded terms
        for lt in leftover_terms:
            lt_key = (lt.get('term') or '').strip().lower()
            le = leftover_eval_map.get(lt_key) or {}

            should_be_ae = le.get('should_be_ae', False)
            is_lt_ambiguous = le.get('is_ambiguous', False) or should_be_ae
            lt_note = le.get('qc_note', '')

            lt['qc'] = {
                'is_ambiguous': bool(is_lt_ambiguous),
                'should_be_ae': bool(should_be_ae),
                'note': lt_note or ("Excluded candidate term flagged by QC for verification." if is_lt_ambiguous else "")
            }
