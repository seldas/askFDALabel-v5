import requests
import urllib3
import re
import os
import logging
import json
from datetime import datetime
from dashboard.config import Config
from dashboard.services.deployment import is_rapid
from dashboard.services.xml_handler import extract_metadata_from_xml
from dashboard.services.fdalabel_db import FDALabelDBService

logger = logging.getLogger(__name__)

_RAPID_EXTERNAL_PROXY = 'http://aws-proxy.fda.gov:8080'


def _external_get(base_url, path, proxies_cfg, ssl_verify_cfg, params=None, timeout=10, stream=False):
    """Issue a GET request to an external FDA/NLM service with RAPID proxy & SSL handling."""
    url = path if path.startswith(('http://', 'https://')) else f"{base_url}/{path.lstrip('/')}"
    rapid = is_rapid()
    proxies = proxies_cfg
    if proxies is None and rapid:
        proxies = {'http': _RAPID_EXTERNAL_PROXY, 'https': _RAPID_EXTERNAL_PROXY}

    if ssl_verify_cfg is not None:
        verify = ssl_verify_cfg
    elif rapid:
        verify = False
    else:
        verify = Config.EXTERNAL_SSL_VERIFY

    if not verify:
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    return requests.get(
        url,
        params=params or None,
        timeout=timeout,
        stream=stream,
        proxies=proxies,
        verify=verify,
    )


def openfda_get(path, params=None, timeout=10, stream=False):
    """Issue a GET request to OpenFDA with configured proxy, API key, and SSL settings."""
    req_params = dict(params) if params else {}
    api_key = req_params.get('api_key') or os.getenv('OPENFDA_API_KEY', '') or Config.OPENFDA_API_KEY
    if api_key and 'api_key' not in req_params:
        req_params['api_key'] = api_key
    return _external_get(
        Config.OPENFDA_URL,
        path,
        Config.OPENFDA_PROXIES,
        Config.OPENFDA_SSL_VERIFY,
        params=req_params,
        timeout=timeout,
        stream=stream,
    )


def dailymed_get(path, params=None, timeout=10, stream=False):
    """Issue a GET request to DailyMed with configured proxy and SSL settings."""
    return _external_get(
        Config.DAILYMED_URL,
        path,
        Config.DAILYMED_PROXIES,
        Config.DAILYMED_SSL_VERIFY,
        params=params,
        timeout=timeout,
        stream=stream,
    )

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

#: Where a user can go when this deployment cannot serve a labeling. Public
#: sites only -- these are shown to anyone who hits a missing SPL.
def external_label_links(set_id):
    """Public lookups for a set_id, for the not-found response."""
    return [
        {
            'name': 'DailyMed',
            'url': f'{Config.DAILYMED_URL}/dailymed/lookup.cfm?setid={set_id}',
        },
        {
            'name': 'FDALabel (public)',
            'url': f'https://nctr-crs.fda.gov/fdalabel/ui/search/spl/{set_id}',
        },
    ]


def label_not_found_payload(set_id, spl_id=None):
    """
    The body for a labeling this deployment cannot serve.

    A 404 with somewhere to go, rather than the 500 this used to raise. The
    identifiers are echoed back so the user can paste them into the links.
    """
    identity = f'set-id "{set_id}"'
    if spl_id:
        identity += f', spl-id "{spl_id}"'
    return {
        'error': (
            f'This labeling ({identity}) cannot be found in the local label '
            'database or the internal FDALabel database. You may look it up on '
            'the following public servers:'
        ),
        'set_id': set_id,
        'spl_id': spl_id,
        'external_links': external_label_links(set_id),
    }


def get_label_xml(set_id, spl_id=None, force_local=False, local_only=False):
    """
    Retrieve SPL XML for set_id.

    Resolution order is fixed and identical in every deployment -- see
    FDALabelDBService.resolve_spl_xml: local file first (by the requested
    version, then by any sibling version of the same set_id), then Oracle.

    force_local=True  -> stop before Oracle, local files only.
    local_only=True   -> retained for callers that passed it while a DailyMed
                         fallback existed. It is now the same as force_local,
                         because there is no network fetch left to suppress.

    Returns None when nothing is found. Callers that render a page should use
    label_not_found_payload() rather than reporting a server error.
    """
    if not set_id and not spl_id:
        return None

    try:
        xml, source = FDALabelDBService.resolve_spl_xml(
            set_id, spl_id=spl_id, force_local=force_local or local_only
        )
    except Exception as e:
        logger.error(f"Error resolving XML for {set_id}: {e}")
        return None

    if not xml:
        logger.warning(f"No SPL XML found for set_id={set_id}, spl_id={spl_id}")
        return None

    if source and source.get('version_substituted'):
        # The pinned version had no file on disk, so a sibling was served. Not
        # silent: the DailyMed fallback that used to do this without saying so
        # is exactly why it was removed.
        logger.warning(
            "Requested spl_id=%s for set_id=%s had no local file; served spl_id=%s instead",
            spl_id, set_id, source.get('spl_id'),
        )

    logger.info(
        "Loaded XML for set_id=%s from %s, length=%d",
        set_id, (source or {}).get('origin', 'unknown'), len(xml),
    )
    return xml


def get_faers_data(drug_name, limit=20):
    if not drug_name or drug_name in ['N/A', 'Unknown Generic']: return None
    clean_name = re.split(r'[,;]', drug_name)[0].strip()
    search_term = f'patient.drug.openfda.generic_name:"{clean_name}"'
    
    try:
        params = {'search': search_term, 'count': 'patient.reaction.reactionmeddrapt.exact', 'limit': limit}
        resp = openfda_get('/drug/event.json', params=params, timeout=10)
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

def check_openfda_status(set_id, is_latest=True):
    """
    Checks if a label with the given set_id is Current or Archived.

    In local, intranet, and RAPID deployments, external network calls to public openFDA
    and public FDALabel endpoints are disabled by default to eliminate blocking
    15-20s HTTP timeouts. Status is determined cleanly from local database metadata.
    """
    if not set_id:
        return None

    # Optional opt-in for remote probing via env var
    if os.environ.get('CHECK_OPENFDA_REMOTE', '').strip().lower() in ('1', 'true', 'yes'):
        has_current = False
        has_failed = False

        # 1. Check openFDA
        params = {
            'search': f'openfda.spl_set_id:"{set_id}"',
            'limit': 1
        }
        try:
            resp = openfda_get('/drug/label.json', params=params, timeout=3)
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
        fdalabel_paths = ["set-ids", "seti-ids"]
        fdalabel_success = False
        for path in fdalabel_paths:
            fdalabel_url = f"https://nctr-crs.fda.gov/fdalabel/services/spl/{path}/{set_id}/spl-doc"
            try:
                resp = requests.get(fdalabel_url, timeout=3)
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

    # Local resolution (default): instant, zero network overhead
    return 'Current' if is_latest is not False else 'Archived'

