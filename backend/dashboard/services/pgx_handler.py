import json
import logging
import re
import uuid
from datetime import datetime
from database import db, PgxBiomarker, PgxAssessment, PgxSynonym, DrugToxicity
from dashboard.services.fda_client import get_label_metadata, get_label_xml
from dashboard.services.ai_handler import generate_assessment, AIClientFactory
try:
    import defusedxml.ElementTree as ET
except ImportError:
    import xml.etree.ElementTree as ET

logger = logging.getLogger(__name__)

# Fallback PGx synonym & biomarker dictionary ensuring assessment works even if DB tables are empty
CORE_PGX_SYNONYMS = {
    # Phase I Enzymes - Cytochrome P450
    'cyp2d6': 'CYP2D6',
    'cytochrome p450 2d6': 'CYP2D6',
    'cyp 2d6': 'CYP2D6',
    'cyp2c19': 'CYP2C19',
    'cytochrome p450 2c19': 'CYP2C19',
    'cyp 2c19': 'CYP2C19',
    'cyp2c9': 'CYP2C9',
    'cytochrome p450 2c9': 'CYP2C9',
    'cyp 2c9': 'CYP2C9',
    'cyp3a4': 'CYP3A4',
    'cytochrome p450 3a4': 'CYP3A4',
    'cyp 3a4': 'CYP3A4',
    'cyp3a5': 'CYP3A5',
    'cytochrome p450 3a5': 'CYP3A5',
    'cyp 3a5': 'CYP3A5',
    'cyp1a2': 'CYP1A2',
    'cytochrome p450 1a2': 'CYP1A2',
    'cyp 1a2': 'CYP1A2',
    'cyp2b6': 'CYP2B6',
    'cytochrome p450 2b6': 'CYP2B6',
    'cyp 2b6': 'CYP2B6',
    'cyp2c8': 'CYP2C8',
    'cytochrome p450 2c8': 'CYP2C8',

    # Phase II & Other Metabolism Enzymes
    'dpyd': 'DPYD',
    'dihydropyrimidine dehydrogenase': 'DPYD',
    'tpmt': 'TPMT',
    'thiopurine s-methyltransferase': 'TPMT',
    'thiopurine methyltransferase': 'TPMT',
    'nudt15': 'NUDT15',
    'nudix hydrolase 15': 'NUDT15',
    'ugt1a1': 'UGT1A1',
    'udp-glucuronosyltransferase 1a1': 'UGT1A1',
    'ugt 1a1': 'UGT1A1',
    'g6pd': 'G6PD',
    'glucose-6-phosphate dehydrogenase': 'G6PD',
    'bche': 'BCHE',
    'pseudocholinesterase': 'BCHE',
    'nat2': 'NAT2',

    # HLA Alleles
    'hla-b*57:01': 'HLA-B*57:01',
    'hla-b*5701': 'HLA-B*57:01',
    'hla-b 5701': 'HLA-B*57:01',
    'hla-b*15:02': 'HLA-B*15:02',
    'hla-b*1502': 'HLA-B*15:02',
    'hla-b 1502': 'HLA-B*15:02',
    'hla-b*58:01': 'HLA-B*58:01',
    'hla-b*5801': 'HLA-B*58:01',
    'hla-a*31:01': 'HLA-A*31:01',
    'hla-a*3101': 'HLA-A*31:01',
    'hla-dqb1*06:02': 'HLA-DQB1*06:02',

    # Transporters & Coagulation
    'slco1b1': 'SLCO1B1',
    'oatp1b1': 'SLCO1B1',
    'abcb1': 'ABCB1',
    'mdr1': 'ABCB1',
    'p-glycoprotein': 'ABCB1',
    'abcg2': 'ABCG2',
    'bcrp': 'ABCG2',
    'vkorc1': 'VKORC1',
    'vitamin k epoxide reductase': 'VKORC1',
    'factor v leiden': 'Factor V Leiden',
    'prothrombin': 'Prothrombin G20210A',

    # Oncologic & Target Biomarkers
    'her2': 'HER2/neu',
    'erbb2': 'HER2/neu',
    'her2/neu': 'HER2/neu',
    'egfr': 'EGFR',
    'epidermal growth factor receptor': 'EGFR',
    'braf': 'BRAF',
    'kras': 'KRAS',
    'nras': 'NRAS',
    'alk': 'ALK',
    'ros1': 'ROS1',
    'ret': 'RET',
    'met': 'MET',
    'ntrk': 'NTRK',
    'brca1': 'BRCA1',
    'brca2': 'BRCA2',
    'flt3': 'FLT3',
    'idh1': 'IDH1',
    'idh2': 'IDH2',
    'pik3ca': 'PIK3CA',
    'fgfr': 'FGFR',
    'bcr-abl': 'BCR-ABL1',
    'bcr-abl1': 'BCR-ABL1',
    'pd-l1': 'PD-L1',
    'pdl1': 'PD-L1',
    'msi-h': 'MSI-H/dMMR',
    'dmmr': 'MSI-H/dMMR',
    'cd20': 'CD20',
    'cd30': 'CD30',
    'cd33': 'CD33'
}


def extract_json_from_response(ai_response):
    """
    Extracts JSON content from an AI response that may contain markdown code blocks
    and additional explanatory text.
    """
    if not ai_response:
        return "{}"

    # Try markdown code blocks ```json ... ``` or ``` ... ```
    pattern = r'```(?:json)?\s*([\s\S]*?)\s*```'
    matches = re.findall(pattern, ai_response, re.IGNORECASE)
    for match in matches:
        candidate = match.strip()
        if (candidate.startswith('{') and candidate.endswith('}')) or (candidate.startswith('[') and candidate.endswith(']')):
            return candidate

    # Try finding outer braces
    start_idx = ai_response.find('{')
    end_idx = ai_response.rfind('}')
    if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
        return ai_response[start_idx:end_idx + 1].strip()

    return ai_response.strip()


def parse_json_safely(raw_str):
    """
    Attempts to parse JSON string with fallback cleaning of trailing commas.
    """
    if not raw_str:
        return None
    try:
        return json.loads(raw_str)
    except Exception:
        pass

    # Try cleaning trailing commas before } or ]
    try:
        cleaned = re.sub(r',\s*([}\]])', r'\1', raw_str)
        return json.loads(cleaned)
    except Exception:
        pass

    return None


def build_biomarker_map():
    """
    Returns a dict: { 'search_term_lower': 'Canonical Name' }
    Combines CORE_PGX_SYNONYMS with database table PgxSynonym if available.
    """
    term_map = dict(CORE_PGX_SYNONYMS)
    try:
        synonyms = db.session.query(PgxSynonym.term, PgxSynonym.normalized_name).all()
        for row in synonyms:
            if row.term and row.normalized_name:
                term_map[row.term.strip().lower()] = row.normalized_name.strip()
    except Exception as e:
        logger.warning(f"Could not query PgxSynonym from DB (using defaults): {e}")
        try:
            db.session.rollback()
        except Exception:
            pass
    return term_map


def get_expected_biomarkers(drug_name):
    """
    Finds expected biomarkers for a drug name from the DB table PgxBiomarker.
    """
    if not drug_name:
        return []
    try:
        biomarkers = PgxBiomarker.query.filter(PgxBiomarker.drug_name.ilike(drug_name)).all()
        if not biomarkers:
            parts = drug_name.split()
            if len(parts) > 1:
                simple_name = parts[0]
                biomarkers = PgxBiomarker.query.filter(PgxBiomarker.drug_name.ilike(simple_name)).all()
        return [b.biomarker_name for b in biomarkers if b.biomarker_name]
    except Exception as e:
        logger.warning(f"Could not query PgxBiomarker from DB: {e}")
        try:
            db.session.rollback()
        except Exception:
            pass
        return []


def _build_markdown_report(biomarkers, drug_name):
    """
    Generates structured Markdown report for rendering in frontend.
    """
    if not biomarkers:
        return f"### Pharmacogenomics (PGx) Assessment\n\n**Drug**: {drug_name}\n\nNo pharmacogenomic biomarker signals or gene-drug interactions identified in this label."

    lines = [f"### Pharmacogenomics (PGx) Assessment\n\n**Drug**: {drug_name}\n"]
    for b in biomarkers:
        name = b.get('biomarker') or b.get('name') or 'Biomarker'
        summary = b.get('summary') or b.get('reason') or ''
        section = b.get('section')
        evidence = b.get('evidence')
        fda = "Yes" if b.get('in_fda_table') else "Not listed in FDA table"

        lines.append(f"#### {name}")
        if summary:
            lines.append(f"- **Clinical Summary**: {summary}")
        if section and section != "N/A":
            lines.append(f"- **Label Section**: {section}")
        if fda:
            lines.append(f"- **FDA PGx Table**: {fda}")
        if evidence:
            lines.append(f"- **Evidence**: *\"{evidence.strip()}\"*")
        lines.append("")

    return "\n".join(lines)


def _save_assessment(set_id, drug_name, payload, user=None):
    """
    Persists PGx results to both PgxAssessment and DrugToxicity tables.
    """
    try:
        final_json = json.dumps(payload)
        
        # 1. PgxAssessment table
        assessment = PgxAssessment.query.filter_by(set_id=set_id).first()
        if assessment:
            assessment.report_content = final_json
            assessment.timestamp = datetime.utcnow()
        else:
            new_assessment = PgxAssessment(set_id=set_id, report_content=final_json)
            db.session.add(new_assessment)

        # 2. DrugToxicity table (for timeline and unified history)
        provider, client, model = (None, None, None)
        try:
            provider, client, model = AIClientFactory.get_client(user)
        except Exception:
            pass
        current_model_str = f"{provider}:{model}" if provider and model else "unknown"
        today_str = datetime.now().strftime("%Y-%m-%d")
        tox_class = payload.get('toxicity_class', 'Informational PGx')
        report_text = payload.get('assessment_report') or final_json

        existing_rec = DrugToxicity.query.filter_by(
            SETID=set_id,
            Tox_Type="PGx",
            is_historical=0
        ).first()

        if existing_rec and existing_rec.Assessment_Date == today_str and existing_rec.AI_Model == current_model_str:
            existing_rec.Toxicity_Class = tox_class
            existing_rec.AI_Summary = report_text
            existing_rec.endpoint = tox_class
            existing_rec.Update_Notes = "Real-time Assessment"
        else:
            if existing_rec:
                existing_rec.is_historical = 1
            new_rec = DrugToxicity(
                SETID=set_id,
                Tox_Type="PGx",
                is_historical=0,
                Toxicity_Class=tox_class,
                AI_Summary=report_text,
                endpoint=tox_class,
                Update_Notes="Real-time Assessment",
                AI_Model=current_model_str,
                Assessment_Date=today_str
            )
            db.session.add(new_rec)

        db.session.commit()
    except Exception as e:
        logger.error(f"Error persisting PGx assessment: {e}")
        try:
            db.session.rollback()
        except Exception:
            pass


def run_pgx_assessment(set_id, user=None, force_refresh=False):
    """
    Performs full PGx assessment for a given set_id:
    1. Checks cache unless force_refresh=True.
    2. Resolves metadata and SPL XML with Oracle and local fallback.
    3. Scans label text against PGx synonyms and FDA expected biomarkers.
    4. Prompts AI model for clinical verification and implications.
    5. Returns unified payload compatible with drugtox frontend.
    """
    # 1. Check existing assessment
    if not force_refresh:
        try:
            assessment = PgxAssessment.query.filter_by(set_id=set_id).first()
            if assessment and assessment.report_content:
                parsed = parse_json_safely(assessment.report_content)
                if parsed and isinstance(parsed, dict):
                    biomarkers = parsed.get('biomarkers', [])
                    norm_biomarkers = []
                    for b in biomarkers:
                        name = b.get('biomarker') or b.get('name') or 'Unknown'
                        summary = b.get('summary') or b.get('reason') or b.get('evidence') or ''
                        norm_biomarkers.append({
                            'biomarker': name,
                            'name': name,
                            'summary': summary,
                            'reason': summary,
                            'evidence': b.get('evidence', ''),
                            'section': b.get('section', ''),
                            'in_fda_table': b.get('in_fda_table', False),
                            'is_valid': b.get('is_valid', True)
                        })
                    tox_class = parsed.get('toxicity_class') or ("Actionable PGx" if norm_biomarkers else "No Biomarkers Found")
                    report_md = parsed.get('assessment_report') or _build_markdown_report(norm_biomarkers, parsed.get('drug', ''))
                    return {
                        'drug': parsed.get('drug', ''),
                        'biomarkers': norm_biomarkers,
                        'assessment_report': report_md,
                        'toxicity_class': tox_class,
                        'raw_response': assessment.report_content,
                        'report': assessment.report_content,
                        'timestamp': assessment.timestamp.isoformat() if assessment.timestamp else None
                    }
        except Exception as cache_err:
            logger.warning(f"Error reading cached PGx assessment: {cache_err}")
            try:
                db.session.rollback()
            except Exception:
                pass
    else:
        try:
            PgxAssessment.query.filter_by(set_id=set_id).delete()
            db.session.commit()
        except Exception as e:
            logger.warning(f"Could not delete old PgxAssessment: {e}")
            try:
                db.session.rollback()
            except Exception:
                pass

    # 2. Get Metadata safely
    meta = get_label_metadata(set_id) or {}
    generic_name = (meta.get('generic_name') or '').strip()
    brand_name = (meta.get('brand_name') or '').strip()
    drug_name = brand_name or generic_name or (meta.get('faers_drug_name') or '').strip() or 'Unknown Drug'

    search_name = generic_name.split(',')[0].strip() if generic_name else ''
    if not search_name:
        search_name = brand_name.split(',')[0].strip() if brand_name else drug_name

    expected_biomarkers = get_expected_biomarkers(search_name)
    expected_str = ", ".join(expected_biomarkers) if expected_biomarkers else "None listed in FDA Table"

    # 3. Resolve spl_id and fetch SPL XML
    spl_id = None
    try:
        from sqlalchemy import text as _text
        row = db.session.execute(
            _text("SELECT spl_id FROM labeling.sum_spl WHERE set_id = :sid AND is_latest = TRUE LIMIT 1"),
            {"sid": set_id}
        ).fetchone()
        if row:
            spl_id = row[0]
        elif meta and meta.get('spl_id'):
            spl_id = meta.get('spl_id')
    except Exception as _e:
        logger.warning(f"Could not resolve spl_id for PGx {set_id}: {_e}")
        try:
            db.session.rollback()
        except Exception:
            pass

    xml_content = get_label_xml(set_id, spl_id=spl_id)
    if not xml_content:
        return {'error': 'Could not retrieve label XML. Ensure the label exists in local storage or configured database.'}

    target_code_map = {
        '34066-1': 'Boxed Warning',
        '34068-7': 'Dosage and Administration',
        '34070-3': 'Contraindications',
        '34071-1': 'Warnings and Precautions',
        '43685-7': 'Warnings and Precautions',
        '34090-1': 'Clinical Pharmacology',
        '42229-4': 'Pharmacogenomics',
        '34067-9': 'Indications and Usage',
        '34092-7': 'Clinical Studies',
        '34089-3': 'Description',
        '34073-7': 'Drug Interactions',
        '43684-0': 'Use in Specific Populations'
    }

    aggregated_text = ""
    try:
        ns = {'v3': 'urn:hl7-org:v3'}
        xml_string_cleaned = xml_content.encode('ascii', 'ignore').decode('ascii')
        root = ET.fromstring(xml_string_cleaned)

        processed_ids = set()
        for section in root.findall(".//v3:section", ns):
            code_el = section.find("v3:code", ns)
            if code_el is not None:
                code_val = code_el.get('code')
                if code_val in target_code_map:
                    sec_id = section.get('ID', str(uuid.uuid4()))
                    if sec_id in processed_ids:
                        continue
                    processed_ids.add(sec_id)

                    section_name = target_code_map[code_val]
                    text_content = " ".join("".join(section.itertext()).split()).strip()
                    if len(text_content) > 10:
                        aggregated_text += f"\n\n### {section_name}\n{text_content}"

        # Also grab Highlights if present
        highlights_text = []
        for excerpt in root.findall(".//v3:excerpt", ns):
            for hl in excerpt.findall(".//v3:highlight", ns):
                hl_text = " ".join("".join(hl.itertext()).split()).strip()
                if hl_text:
                    highlights_text.append(hl_text)
        if highlights_text:
            aggregated_text = f"### Highlights of Prescribing Information\n" + "\n".join(highlights_text) + "\n\n" + aggregated_text

    except Exception as e:
        logger.error(f"XML parsing error in PGx: {e}")
        return {'error': 'Failed to parse label XML structure'}

    if not aggregated_text.strip():
        empty_res = {
            'drug': search_name,
            'biomarkers': [],
            'toxicity_class': 'No Biomarkers Found',
            'assessment_report': f"### Pharmacogenomics (PGx) Assessment\n\n**Drug**: {search_name}\n\nNo relevant clinical sections found in label.",
            'raw_response': 'No text found in relevant sections.',
            'report': json.dumps({'biomarkers': [], 'message': 'No text found in relevant sections.'})
        }
        _save_assessment(set_id, search_name, empty_res, user)
        return empty_res

    # 4. Scan for Synonyms & expected biomarkers
    term_map = build_biomarker_map()
    found_candidates = set()

    all_terms = sorted(term_map.keys(), key=len, reverse=True)
    if all_terms:
        escaped_terms = [re.escape(t) for t in all_terms]
        pattern_str = r'\b(' + '|'.join(escaped_terms) + r')\b'
        try:
            pattern = re.compile(pattern_str, re.IGNORECASE)
            for m in pattern.findall(aggregated_text):
                lower_m = m.lower()
                if lower_m in term_map:
                    found_candidates.add(term_map[lower_m])
        except Exception as e:
            logger.error(f"Regex error in PGx scan: {e}")

    # If no candidates found in text and no FDA expected biomarkers, finish early cleanly
    if not found_candidates and not expected_biomarkers:
        empty_res = {
            'drug': search_name,
            'biomarkers': [],
            'toxicity_class': 'No Biomarkers Found',
            'assessment_report': f"### Pharmacogenomics (PGx) Assessment\n\n**Drug**: {search_name}\n\nNo pharmacogenomic biomarker terms or gene-drug interactions were identified in the prescribing information.",
            'raw_response': 'No candidate PGx biomarker terms found in label text.',
            'report': json.dumps({'biomarkers': [], 'message': 'No known pharmacogenomic biomarker terms found.'})
        }
        _save_assessment(set_id, search_name, empty_res, user)
        return empty_res

    found_list_str = ", ".join(sorted(found_candidates)) if found_candidates else "None explicitly matched in initial scan"

    # 5. Prompt AI for clinical PGx assessment
    prompt = f"""
You are an expert clinical pharmacologist and pharmacogenomics (PGx) specialist.

Drug Name: "{search_name}"
Candidate PGx Biomarker terms detected in label: {found_list_str}
Expected FDA Table Biomarkers: {expected_str}

Please carefully analyze the provided prescribing information text below for pharmacogenomic biomarkers, metabolic enzymes (e.g., CYP2D6, CYP2C19), HLA associations, drug transporters, and target mutations.

For each biomarker:
1. Verify if it is an actual biomarker relevant to this drug's metabolism, dosing, contraindications, or efficacy.
2. Extract the key evidence sentence(s) directly from the text.
3. Identify which section it appears in (e.g. Boxed Warning, Contraindications, Warnings and Precautions, Dosage and Administration, Clinical Pharmacology).
4. Provide a clear clinical summary explaining the clinical implication (e.g., dose adjustments, poor metabolizer risks, pre-treatment genetic testing recommendations).

Output strictly valid JSON with NO additional commentary in the following schema:
{{
    "drug": "{search_name}",
    "toxicity_class": "Actionable PGx" or "Informational PGx" or "No Biomarkers Found",
    "biomarkers": [
        {{
            "biomarker": "Canonical Biomarker Name (e.g. CYP2D6)",
            "summary": "Clinical summary and implications for patient care...",
            "evidence": "Extracted sentence or key excerpt from label...",
            "section": "Section Name",
            "in_fda_table": true or false,
            "is_valid": true
        }}
    ]
}}
"""

    try:
        ai_response = generate_assessment(user, prompt, aggregated_text)
        clean_json = extract_json_from_response(ai_response)
        data = parse_json_safely(clean_json)

        if not data or not isinstance(data, dict):
            # Fallback if AI produced non-JSON text
            data = {
                'drug': search_name,
                'toxicity_class': 'Informational PGx' if found_candidates else 'No Biomarkers Found',
                'biomarkers': []
            }
            if found_candidates:
                for c in sorted(found_candidates):
                    data['biomarkers'].append({
                        'biomarker': c,
                        'summary': f"Biomarker mention detected in label text for {search_name}.",
                        'evidence': '',
                        'section': 'Prescribing Information',
                        'in_fda_table': c in expected_biomarkers,
                        'is_valid': True
                    })

        # 6. Normalize biomarkers
        raw_biomarkers = data.get('biomarkers', [])
        norm_biomarkers = []
        found_names = set()

        for b in raw_biomarkers:
            if not isinstance(b, dict):
                continue
            is_valid = b.get('is_valid', True)
            if not is_valid:
                continue

            name = b.get('biomarker') or b.get('name') or 'Unknown'
            found_term = b.get('found_term') or name
            reason = b.get('summary') or b.get('reason') or ''
            section = b.get('section') or 'Clinical Pharmacology'
            evidence = b.get('evidence') or ''
            in_fda = b.get('in_fda_table', False)

            # Build enriched summary for frontend display
            summary_parts = []
            if reason:
                summary_parts.append(reason)
            if section and section != "N/A" and section not in reason:
                summary_parts.append(f"[{section}]")
            if evidence and evidence not in reason:
                summary_parts.append(f"\n> *\"{evidence.strip()}\"*")

            full_summary = " ".join(summary_parts[:2])
            if len(summary_parts) > 2:
                full_summary += "\n" + summary_parts[2]

            norm_biomarkers.append({
                'biomarker': name,
                'name': name,
                'summary': full_summary,
                'reason': reason,
                'evidence': evidence,
                'section': section,
                'in_fda_table': in_fda,
                'is_valid': True
            })
            found_names.add(name.lower())

        # Include unmentioned FDA expected biomarkers as unconfirmed notes
        for exp in expected_biomarkers:
            if exp.lower() not in found_names:
                norm_biomarkers.append({
                    'biomarker': exp,
                    'name': exp,
                    'summary': "Listed in FDA Table of Pharmacogenomic Biomarkers in Drug Labeling, but no explicit dosing guidance found in this specific label.",
                    'reason': "Listed in FDA PGx Table; not confirmed in text.",
                    'evidence': '',
                    'section': 'FDA Table Reference',
                    'in_fda_table': True,
                    'is_valid': False
                })

        # Determine toxicity class
        has_actionable = any(
            b.get('is_valid') and any(term in (b.get('section', '') + b.get('summary', '')).lower() 
                                      for term in ['contraindication', 'boxed warning', 'black box', 'dose reduction', 'adjust dose', 'avoid'])
            for b in norm_biomarkers
        )
        if has_actionable:
            tox_class = "Actionable PGx"
        elif any(b.get('is_valid') for b in norm_biomarkers):
            tox_class = "Informational PGx"
        else:
            tox_class = "No Biomarkers Found"

        markdown_report = _build_markdown_report(norm_biomarkers, search_name)
        final_payload = {
            'drug': search_name,
            'biomarkers': norm_biomarkers,
            'assessment_report': markdown_report,
            'toxicity_class': tox_class,
            'raw_response': ai_response,
            'report': json.dumps({
                'drug': search_name,
                'toxicity_class': tox_class,
                'biomarkers': norm_biomarkers
            })
        }

        _save_assessment(set_id, search_name, final_payload, user)

        final_payload['timestamp'] = datetime.utcnow().isoformat()
        return final_payload

    except Exception as e:
        logger.error(f"PGx AI Error: {e}", exc_info=True)
        return {'error': f"AI Analysis Failed: {str(e)}"}

