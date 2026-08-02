import requests
import logging
from dashboard.config import Config
from dashboard.services.fda_client import handle_openfda_error

logger = logging.getLogger(__name__)

def find_devices(query_term, skip=0, limit=10):
    """
    Search across various openFDA device endpoints (510k and PMA).
    """
    results = []
    total = 0
    
    # Check for K-number (510k) or P-number (PMA)
    is_k_num = query_term.upper().startswith('K') and query_term[1:].isdigit()
    is_p_num = query_term.upper().startswith('P') and query_term[1:].isdigit()

    endpoints = []
    if is_k_num:
        endpoints = [("https://api.fda.gov/device/510k.json", "510(k)", f'k_number:"{query_term}"')]
    elif is_p_num:
        endpoints = [("https://api.fda.gov/device/pma.json", "PMA", f'pma_number:"{query_term}"')]
    else:
        # Search both for generic terms
        search_query = f'(device_name:"{query_term}" OR applicant:"{query_term}")'
        endpoints = [
            ("https://api.fda.gov/device/510k.json", "510(k)", search_query),
            ("https://api.fda.gov/device/pma.json", "PMA", search_query)
        ]

    for url, dev_type, q in endpoints:
        params = {
            'search': q,
            'limit': limit,
            'skip': skip
        }
        if Config.OPENFDA_API_KEY:
            params['api_key'] = Config.OPENFDA_API_KEY

        try:
            response = requests.get(url, params=params, timeout=10)
            if response.status_code == 200:
                data = response.json()
                total += data.get('meta', {}).get('results', {}).get('total', 0)
                
                for r in data.get('results', []):
                    results.append({
                        'id': r.get('k_number') or r.get('pma_number'),
                        'name': r.get('device_name') or r.get('generic_name'),
                        'manufacturer': r.get('applicant'),
                        'type': dev_type,
                        'product_code': r.get('product_code'),
                        'date': r.get('decision_date') or r.get('fed_reg_notice_date'),
                        'decision_description': r.get('decision_description') or r.get('pma_type')
                    })
        except requests.exceptions.RequestException as e:
            msg = handle_openfda_error(e)
            logger.error(f"Error searching {dev_type}: {msg}")
            return {"error": msg}, 0
        except Exception as e:
            logger.error(f"Error searching {dev_type}: {e}")

    # Deduplicate by ID and sort by date
    unique_results = []
    seen_ids = set()
    for res in results:
        if res['id'] and res['id'] not in seen_ids:
            unique_results.append(res)
            seen_ids.add(res['id'])
    
    # Sort by date descending (handle N/A or empty strings)
    unique_results.sort(key=lambda x: x.get('date') or '', reverse=True)
    
    return unique_results[:limit], total

def get_device_metadata(k_number):
    """
    Fetch detailed device info including registration/listing metadata if available.
    """
    return None

def get_manufacturer_by_id(identifier):
    """
    Retrieves the manufacturer (applicant) name for a given K-number or PMA-number.
    """
    if not identifier:
        return None
        
    is_pma = identifier.upper().startswith('P')
    endpoint = "pma.json" if is_pma else "510k.json"
    id_field = "pma_number" if is_pma else "k_number"
    
    url = f"https://api.fda.gov/device/{endpoint}"
    params = {'search': f'{id_field}:"{identifier}"', 'limit': 1}
    if Config.OPENFDA_API_KEY:
        params['api_key'] = Config.OPENFDA_API_KEY
        
    try:
        resp = requests.get(url, params=params, timeout=10)
        if resp.status_code == 200:
            results = resp.json().get('results', [])
            if results:
                return results[0].get('applicant')
    except Exception as e:
        logger.error(f"Error fetching manufacturer for {identifier}: {e}")
    return None

def get_device_ifu(identifier):
    """
    Retrieves the Indications for Use or Statement of Indications for a given K-number or PMA-number.
    """
    if not identifier:
        return None
        
    is_pma = identifier.upper().startswith('P')
    endpoint = "pma.json" if is_pma else "510k.json"
    id_field = "pma_number" if is_pma else "k_number"
    
    url = f"https://api.fda.gov/device/{endpoint}"
    params = {'search': f'{id_field}:"{identifier}"', 'limit': 1}
    if Config.OPENFDA_API_KEY:
        params['api_key'] = Config.OPENFDA_API_KEY
        
    try:
        resp = requests.get(url, params=params, timeout=10)
        if resp.status_code == 200:
            results = resp.json().get('results', [])
            if results:
                return results[0].get('indications_for_use') or results[0].get('statement_of_indications') or "No Indications for Use found."
    except requests.exceptions.RequestException as e:
        return handle_openfda_error(e)
    except Exception as e:
        logger.error(f"Error fetching IFU for {identifier}: {e}")
    return "Error retrieving data."

def get_maude_data(product_code, limit=20):
    """
    Fetch MAUDE reports (device/event.json) by FDA Product Code.
    """
    if not product_code:
        return None
        
    base_url = "https://api.fda.gov/device/event.json"
    search_query = f'device.device_report_product_code:"{product_code}"'
    
    try:
        count_params = {
            'search': search_query,
            'count': 'event_type.exact',
            'limit': 10
        }
        if Config.OPENFDA_API_KEY:
            count_params['api_key'] = Config.OPENFDA_API_KEY
            
        resp = requests.get(base_url, params=count_params, timeout=10)
        if resp.status_code == 200:
            return resp.json().get('results', [])
    except Exception as e:
        logger.error(f"Error fetching MAUDE data: {e}")
    return None
