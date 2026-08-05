import requests
import re
import os
import logging
import json
from datetime import datetime
from dashboard.config import Config
from dashboard.services.xml_handler import extract_metadata_from_xml
from dashboard.services.fdalabel_db import FDALabelDBService

logger = logging.getLogger(__name__)

def identify_query_type(term):
    """
    Identifies the type of query term: Set ID, UNII, NDC, or Brand Name.
    Returns the appropriate openFDA search field.
    """
    term = term.strip()
    # Check for Set ID (UUID)
    uuid_pattern = r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    # Check for UNII (10 alphanumeric characters)
    unii_pattern = r'^[A-Z0-9]{10}$'
    # Check for NDC
    ndc_pattern = r'^\d{3,5}-\d{2,4}(-\d{1,2})?$' 

    if re.match(uuid_pattern, term):
        return f'openfda.spl_set_id:"{term}"'
    elif re.match(unii_pattern, term):
        return f'openfda.unii:"{term}"'
    elif re.match(ndc_pattern, term):
        return f'(openfda.product_ndc:"{term}" OR openfda.package_ndc:"{term}")'
    else:
        return f'(openfda.brand_name:"{term}" OR openfda.generic_name:"{term}")'

def handle_openfda_error(e):
    """
    Centralized handler for openFDA connection errors.
    Returns a user-friendly message indicating API unavailability.
    """
    error_msg = str(e)
    # Check for common connection errors
    if "ConnectionError" in error_msg or "Max retries exceeded" in error_msg or "Timeout" in error_msg or "getaddrinfo failed" in error_msg or "Simulated Offline" in error_msg:
        return "The openFDA API is currently not available under the current internet environment. This is a connectivity issue, not a system error."
    return f"Error connecting to openFDA: {error_msg}"

def find_labels(query_term, skip=0, limit=10, use_local_db=False):
    """
    Search for labels using the internal FDALabel DB.
    Falls back to Local Postgres if Oracle is unavailable, unless force_local is True.
    """
    if FDALabelDBService.check_connectivity():
        internal_limit = 100000
        results = FDALabelDBService.search_labels(query_term, skip=skip, limit=internal_limit, force_local=use_local_db)
        return results, len(results)
    return [], 0

def find_labels_by_set_ids(terms_list, skip=0, limit=10, use_local_db=False):
    if not terms_list: return [], 0
    all_results = FDALabelDBService.get_labels_by_set_ids_bulk(terms_list, force_local=use_local_db)
    return all_results[skip:skip+limit], len(all_results)

def get_label_metadata(set_id, import_id=None, spl_id=None, use_local_db=False):
    if import_id:
        import_path = os.path.join(Config.UPLOAD_FOLDER, f"import_{import_id}.json")
        if os.path.exists(import_path):
            with open(import_path, 'r', encoding='utf-8') as f:
                labels = json.load(f)
                for l in labels:
                    if l['set_id'] == set_id: return l

    if FDALabelDBService.check_connectivity():
        meta = FDALabelDBService.get_label_metadata(set_id, spl_id=spl_id, force_local=use_local_db)
        if meta: return meta

    return None

def get_label_xml(set_id, spl_id=None, force_local=False, local_only=False):
    """
    Retrieve SPL XML for set_id.

    force_local=True  → always use local Postgres DB, never Oracle.
    local_only=True   → suppress the DailyMed HTTP fallback entirely;
                        return None if local DB has no XML.
    """
    if not set_id:
        return None

    try:
        db_xml = FDALabelDBService.get_full_xml(set_id, spl_id=spl_id, force_local=force_local)
        if db_xml:
            logger.info(f"Loaded XML from local DB/ZIP for set_id={set_id}, spl_id={spl_id}, length={len(db_xml)}")
            return db_xml
    except Exception as e:
        logger.error(f"Error reading local XML for {set_id}: {e}")

    if local_only:
        logger.warning(f"local_only=True and no local XML found for set_id={set_id}; skipping DailyMed.")
        return None

    dailymed_url = f"https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/{set_id}.xml"
    try:
        response = requests.get(dailymed_url, timeout=10)
        response.raise_for_status()
        logger.info(f"Loaded XML from DailyMed for set_id={set_id}, length={len(response.text)}")
        return response.text
    except Exception as e:
        logger.error(f"Error fetching from DailyMed for {set_id}: {e}")

    return None

def get_faers_data(drug_name, limit=20):
    if not drug_name or drug_name in ['N/A', 'Unknown Generic']: return None
    clean_name = re.split(r'[,;]', drug_name)[0].strip()
    base_url = "https://api.fda.gov/drug/event.json"
    search_term = f'patient.drug.openfda.generic_name:"{clean_name}"'
    
    try:
        params = {'search': search_term, 'count': 'patient.reaction.reactionmeddrapt.exact', 'limit': limit}
        if Config.OPENFDA_API_KEY: params['api_key'] = Config.OPENFDA_API_KEY
        resp = requests.get(base_url, params=params, timeout=10)
        if resp.status_code == 200:
            return {'reactions': resp.json().get('results', []), 'dates': []}
    except requests.exceptions.RequestException as e:
        return {"error": handle_openfda_error(e)}
    return None

def get_label_counts(generic_name=None, epc=None, use_local_db=False):
    """
    Queries FDALabel DB to get counts of labels for a specific generic name and/or EPC.
    """
    if FDALabelDBService.check_connectivity():
        return FDALabelDBService.get_label_counts(generic_name=generic_name, epc=epc, force_local=use_local_db)
    return {"generic_count": 0, "epc_count": 0}
def get_rich_metadata_by_generic(generic_name):
    """
    Deprecated: openFDA removal. EPC/MOA should be retrieved via internal queries.
    """
    return None

def check_openfda_status(set_id):
    """
    Checks if a label with the given set_id exists in openFDA or public FDALabel.
    Returns:
      'Current' if found in either of them,
      'Archived' if not found in either (verified on all working ones),
      None if the checks were inconclusive (e.g. connection/timeout error on a checked API) and not found to be Current.
    """
    if not set_id:
        return None

    has_current = False
    has_failed = False

    # 1. Check openFDA
    openfda_url = "https://api.fda.gov/drug/label.json"
    params = {
        'search': f'openfda.spl_set_id:"{set_id}"',
        'limit': 1
    }
    if Config.OPENFDA_API_KEY:
        params['api_key'] = Config.OPENFDA_API_KEY
    try:
        resp = requests.get(openfda_url, params=params, timeout=5)
        if resp.status_code == 200:
            results = resp.json().get('results', [])
            if results:
                has_current = True
        elif resp.status_code == 404:
            pass  # Not found
        else:
            logger.warning(f"openFDA returned unexpected status {resp.status_code} for set_id {set_id}")
            has_failed = True
    except Exception as e:
        logger.error(f"Error checking openFDA status for set_id {set_id}: {e}")
        has_failed = True

    if has_current:
        return 'Current'

    # 2. Check FDALabel Public
    # Path variant 1: set-ids (correct working path)
    # Path variant 2: seti-ids (as specified in user prompt)
    fdalabel_paths = ["set-ids", "seti-ids"]
    fdalabel_success = False
    for path in fdalabel_paths:
        fdalabel_url = f"https://nctr-crs.fda.gov/fdalabel/services/spl/{path}/{set_id}/spl-doc"
        try:
            resp = requests.get(fdalabel_url, timeout=5)
            if resp.status_code == 200:
                has_current = True
                fdalabel_success = True
                break
            elif resp.status_code in [404, 500]:
                fdalabel_success = True
            else:
                logger.warning(f"FDALabel Public ({path}) returned unexpected status {resp.status_code} for set_id {set_id}")
        except Exception as e:
            logger.error(f"Error checking FDALabel Public ({path}) status for set_id {set_id}: {e}")
            
    if not fdalabel_success:
        has_failed = True

    if has_current:
        return 'Current'

    if has_failed:
        return None

    return 'Archived'

