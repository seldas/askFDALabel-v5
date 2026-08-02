import json
import logging
import re
from database import db, PgxBiomarker, PgxAssessment, PgxSynonym
from dashboard.services.fda_client import get_label_metadata, get_label_xml
from dashboard.services.ai_handler import generate_assessment
import xml.etree.ElementTree as ET
import uuid
from datetime import datetime

logger = logging.getLogger(__name__)

def extract_json_from_response(ai_response):
    """
    Extracts JSON content from an AI response that may contain markdown code blocks
    and additional explanatory text.
    """
    # Try to find JSON within markdown code blocks first
    json_pattern = r'json\s([\s\S]?)\s*```'
    match = re.search(json_pattern, ai_response)
    if match:
        return match.group(1).strip()

    # If no markdown block found, try to find raw JSON
    try:
        start_idx = ai_response.index('{')
        # Find the matching closing brace
        brace_count = 0
        for i in range(start_idx, len(ai_response)):
            if ai_response[i] == '{':
                brace_count += 1
            elif ai_response[i] == '}':
                brace_count -= 1
                if brace_count == 0:
                    return ai_response[start_idx:i+1].strip()
    except (ValueError, IndexError):
        pass
    # If all else fails, return the stripped response
    return ai_response.strip()

def build_biomarker_map():
    """
    Returns a dict: { 'search_term_lower': 'Canonical Name' }
    """
    synonyms = db.session.query(PgxSynonym.term, PgxSynonym.normalized_name).all()
    term_map = {row.term: row.normalized_name for row in synonyms}
    return term_map

def get_expected_biomarkers(drug_name):
    """
    Finds expected biomarkers for a drug name from the DB.
    """
    # Simple case-insensitive match
    biomarkers = PgxBiomarker.query.filter(PgxBiomarker.drug_name.ilike(drug_name)).all()
    
    if not biomarkers:
        parts = drug_name.split()
        if len(parts) > 1:
            simple_name = parts[0]
            biomarkers = PgxBiomarker.query.filter(PgxBiomarker.drug_name.ilike(simple_name)).all()
            
    return [b.biomarker_name for b in biomarkers]

def run_pgx_assessment(set_id, user=None, force_refresh=False):
    # 1. Check existing assessment
    assessment = PgxAssessment.query.filter_by(set_id=set_id).first()
    
    if assessment:
        if force_refresh:
            db.session.delete(assessment)
            db.session.commit()
        else:
            return {'report': assessment.report_content, 'timestamp': assessment.timestamp}

    # 2. Get Metadata
    meta = get_label_metadata(set_id)
    if not meta:
        return {'error': 'Label metadata not found'}
    
    drug_name = meta.get('brand_name') or meta.get('generic_name')
    if not drug_name:
         return {'error': 'Drug name not found'}
    
    search_name = meta.get('generic_name', '').split(',')[0].strip()
    if not search_name:
        search_name = meta.get('brand_name', '').split(',')[0].strip()

    expected_biomarkers = get_expected_biomarkers(search_name)
    expected_str = ", ".join(expected_biomarkers) if expected_biomarkers else "None listed in FDA Table"

    # 3. Get XML & Extract Text
    xml_content = get_label_xml(set_id)
    if not xml_content:
        return {'error': 'Label XML not found'}

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
        '34089-3': 'Description'
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
                    if sec_id in processed_ids: continue
                    processed_ids.add(sec_id)
                    
                    section_name = target_code_map[code_val]
                    text_content = "".join(section.itertext()).strip()
                    if len(text_content) > 10:
                        aggregated_text += f"\n\n### {section_name}\n{text_content}"
    except Exception as e:
        logger.error(f"XML parsing error in PGx: {e}")
        return {'error': 'Failed to parse label text'}

    if not aggregated_text:
        return {'report': json.dumps({'biomarkers': [], 'message': 'No text found in relevant sections.'})}

    # 4. Scan for Synonyms
    term_map = build_biomarker_map()
    found_candidates = set()
    
    # Sort terms by length (desc) to optimize regex matching (longest match first)
    all_terms = sorted(term_map.keys(), key=len, reverse=True)
    # Chunk regex to avoid "regular expression is too large" error if list is huge (unlikely for <1000 terms but safe)
    # Python regex limit is quite high, but let's be safe.
    # 600 terms is fine.
    escaped_terms = [re.escape(t) for t in all_terms]
    pattern_str = r'\b(' + '|'.join(escaped_terms) + r')\b'
    
    try:
        pattern = re.compile(pattern_str, re.IGNORECASE)
        matches = set(pattern.findall(aggregated_text)) 
    except Exception as e:
        logger.error(f"Regex error: {e}")
        matches = set()

    for m in matches:
        lower_m = m.lower()
        if lower_m in term_map:
            found_candidates.add(term_map[lower_m]) # Add canonical name

    if not found_candidates:
        return {'report': json.dumps({
            'biomarkers': [], 
            'message': 'No known pharmacogenomic biomarker terms found in the label text.'
        })}

    found_list_str = ", ".join(found_candidates)

    # 5. Prompt AI
    prompt = f"""
    You are an expert in Pharmacogenomics (PGx).
    
    I have scanned the drug label for "{search_name}" and found text matches for the following potential biomarker terms:
    {found_list_str}
    
    Please verify each of these found terms against the label text provided below.
    
    Also, cross-reference with the FDA Table of Pharmacogenomic Biomarkers. 
    According to my database, the EXPECTED biomarkers for this drug are: {expected_str}.
    
    For each found term:
    1. **Verify Relevance**: Is this actually a biomarker mention relevant to this drug? (Ignore false positives like codes, simple abbreviations with different meanings).
    2. **Evidence**: Extract the specific sentence(s) context. KEEP IT CONCISE.
    3. **Status**: Is it in the FDA Table list provided above?
    4. **Reasoning**: Briefly explain why it is or isn't a valid biomarker for this drug.
    
    Output strictly valid JSON in the following format:
    {{
        "drug": "{search_name}",
        "biomarkers": [
            {{
                "name": "Canonical Name (e.g. CYP2D6)",
                "found_term": "Actual term found (e.g. CYP2D6)",
                "is_valid": true,
                "in_fda_table": true,
                "evidence": "Extracted sentence...",
                "section": "Section Name",
                "reason": "Explanation..."
            }}
        ]
    }}
    
    Only include items where "is_valid" is true.
    Your response should only include the json formatted data, no other texts.
    """
    
    try:        
        ai_response = generate_assessment(user, prompt, aggregated_text)
        clean_json = extract_json_from_response(ai_response)
        data = json.loads(clean_json)  # Validate
        
        # 6. Post-process: Add missing expected biomarkers
        # Normalize found names for comparison
        found_valid_names = set()
        if 'biomarkers' in data:
            for b in data['biomarkers']:
                if b.get('is_valid'):
                    found_valid_names.add(b.get('name', '').lower())
        else:
            data['biomarkers'] = []

        for expected in expected_biomarkers:
            if expected.lower() not in found_valid_names:
                data['biomarkers'].append({
                    "name": expected,
                    "found_term": None,
                    "is_valid": False,
                    "in_fda_table": True,
                    "evidence": None,
                    "section": "N/A",
                    "reason": "Listed in FDA Pharmacogenomic Biomarkers Table but not found in this label."
                })
        
        final_json = json.dumps(data)
        
        new_assessment = PgxAssessment(set_id=set_id, report_content=final_json)
        db.session.add(new_assessment)
        db.session.commit()
        
        return {'report': final_json}

    except Exception as e:
        logger.error(f"PGx AI Error: {e}")
        return {'error': f"AI Analysis Failed: {str(e)}"}
