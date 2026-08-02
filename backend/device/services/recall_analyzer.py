import requests
import logging
from dashboard.config import Config
from device.services.device_client import get_manufacturer_by_id

logger = logging.getLogger(__name__)

def get_device_recalls(product_code, k_number=None):
    """
    Fetches recall and enforcement data for a specific Product Code.
    If k_number is provided, focuses on the specific manufacturer.
    Returns a summary of recalls (Class I, II, III) and recent recall events.
    """
    if not product_code:
        return None

    base_url = "https://api.fda.gov/device/enforcement.json"
    
    summary = {
        'total_recalls': 0,
        'class_i': 0,
        'class_ii': 0,
        'class_iii': 0,
        'recent_recalls': [],
        'manufacturer_specific_recalls': 0
    }

    try:
        # We search by product code
        search_query_class = f'product_code:"{product_code}"'
        
        # Get overall counts by classification
        params_count = {
            'search': search_query_class,
            'count': 'classification.exact'
        }
        if Config.OPENFDA_API_KEY:
            params_count['api_key'] = Config.OPENFDA_API_KEY
            
        resp_count = requests.get(base_url, params=params_count, timeout=10)
        if resp_count.status_code == 200:
            results = resp_count.json().get('results', [])
            for res in results:
                term = res.get('term', '').upper()
                count = res.get('count', 0)
                summary['total_recalls'] += count
                if 'CLASS I' in term and 'CLASS II' not in term and 'CLASS III' not in term:
                    summary['class_i'] += count
                elif 'CLASS II' in term and 'CLASS III' not in term:
                    summary['class_ii'] += count
                elif 'CLASS III' in term:
                    summary['class_iii'] += count

        # Get the most recent recalls for this product code
        params_recent = {
            'search': search_query_class,
            'sort': 'recall_initiation_date:desc',
            'limit': 5
        }
        if Config.OPENFDA_API_KEY:
            params_recent['api_key'] = Config.OPENFDA_API_KEY

        resp_recent = requests.get(base_url, params=params_recent, timeout=10)
        if resp_recent.status_code == 200:
            summary['recent_recalls'] = resp_recent.json().get('results', [])

        # If a specific K-number is given, find recalls for this specific manufacturer
        if k_number:
            mfr_name = get_manufacturer_by_id(k_number)
            if mfr_name:
                clean_mfr = mfr_name.replace('"', '').upper()
                for suffix in [' INC', ' LLC', ' CORP', ' CO', ' LTD', ' GMBH', ' S.A.']:
                    clean_mfr = clean_mfr.replace(suffix, '')
                clean_mfr = ' '.join(clean_mfr.split()[:2])
                
                search_query_mfr = f'{search_query_class} AND recalling_firm:"{clean_mfr}"'
                
                params_mfr_count = {
                    'search': search_query_mfr,
                    'limit': 1
                }
                if Config.OPENFDA_API_KEY:
                    params_mfr_count['api_key'] = Config.OPENFDA_API_KEY
                
                resp_mfr = requests.get(base_url, params=params_mfr_count, timeout=10)
                if resp_mfr.status_code == 200:
                    summary['manufacturer_specific_recalls'] = resp_mfr.json().get('meta', {}).get('results', {}).get('total', 0)

    except Exception as e:
        logger.error(f"Error fetching recall data for {product_code}: {e}")
        return None

    return summary
