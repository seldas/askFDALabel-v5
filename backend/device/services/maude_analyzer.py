import requests
import logging
from datetime import datetime
from dashboard.config import Config

logger = logging.getLogger(__name__)

from device.services.device_client import get_manufacturer_by_id
from dashboard.services.ai_handler import call_llm
from flask_login import current_user
import json

def get_maude_summary(product_code, k_number=None):
    """
    Fetches and aggregates MAUDE data for a specific Product Code.
    Uses AI to reconcile manufacturer names between 510k/PMA and MAUDE databases.
    """
    if not product_code:
        return None

    base_url = "https://api.fda.gov/device/event.json"
    current_year = datetime.now().year
    start_date = f"{current_year - 3}0101"
    end_date = f"{current_year}1231"
    date_filter = f"date_received:[{start_date} TO {end_date}]"
    
    summary = {
        'event_types': [],
        'trends': [],
        'manufacturer_trends': [],
        'manufacturers': [],
        'target_manufacturer': None,
        'maude_name_match': None
    }

    try:
        # 1. Fetch Top 20 Manufacturers for THIS Product Code (Broad list for AI)
        search_query_class = f'device.device_report_product_code:"{product_code}"'
        params_mfr_list = {
            'search': f"{search_query_class} AND {date_filter}",
            'count': 'device.manufacturer_d_name.exact',
            'limit': 20
        }
        if Config.OPENFDA_API_KEY:
            params_mfr_list['api_key'] = Config.OPENFDA_API_KEY
            
        resp_list = requests.get(base_url, params=params_mfr_list, timeout=10)
        raw_mfrs = resp_list.json().get('results', []) if resp_list.status_code == 200 else []
        summary['manufacturers'] = raw_mfrs[:5] # Show top 5 in UI

        # 2. Get Official Applicant Name from 510k/PMA
        official_mfr = get_manufacturer_by_id(k_number) if k_number else None
        summary['target_manufacturer'] = official_mfr

        # 3. AI RECONCILIATION: Map Official Name to MAUDE Facet Name
        if official_mfr and raw_mfrs:
            mfr_names_in_maude = [m['term'] for m in raw_mfrs]
            system_prompt = (
                "You are a clinical data scientist. I have an official manufacturer name and a list of manufacturer names as they appear in safety reports (MAUDE). "
                "Identify which name in the list is the most likely match for the official name. "
                "Return ONLY the exact string from the list. If no good match, return 'NONE'."
            )
            user_message = (
                f"Official manufacturer name: '{official_mfr}'.\n"
                f"MAUDE List: {mfr_names_in_maude}."
            )
            maude_name = call_llm(current_user, system_prompt, user_message).strip().replace('"', '').replace("'", "")
            if maude_name != "NONE":
                summary['maude_name_match'] = maude_name

        # 4. Fetch Trend for the RECONCILED name (or fallback to broad search)
        target_name_for_search = summary['maude_name_match'] or official_mfr
        if target_name_for_search:
            # Use .exact if we have a maude_name_match for 100% consistency
            if summary['maude_name_match']:
                search_query_mfr = f'device.device_report_product_code:"{product_code}" AND device.manufacturer_d_name.exact:"{target_name_for_search}"'
            else:
                clean_mfr = ' '.join(target_name_for_search.replace('"', '').split()[:2])
                search_query_mfr = f'device.device_report_product_code:"{product_code}" AND device.manufacturer_d_name:"{clean_mfr}"'
            
            params_mfr_trend = {
                'search': f"{search_query_mfr} AND {date_filter}",
                'count': 'date_received',
            }
            if Config.OPENFDA_API_KEY:
                params_mfr_trend['api_key'] = Config.OPENFDA_API_KEY
                
            resp_mfr = requests.get(base_url, params=params_mfr_trend, timeout=10)
            if resp_mfr.status_code == 200:
                mfr_raw_dates = resp_mfr.json().get('results', [])
                mfr_monthly_counts = {}
                for item in mfr_raw_dates:
                    month_key = item.get('time', '')[:6]
                    if month_key and len(month_key) == 6:
                        mfr_monthly_counts[month_key] = mfr_monthly_counts.get(month_key, 0) + item.get('count', 0)
                summary['manufacturer_trends'] = [{'time': k, 'count': v} for k, v in sorted(mfr_monthly_counts.items())]

        # 5. Standard Class-wide Stats (Distribution & Class Trend)
        params_type = {'search': f"{search_query_class} AND {date_filter}", 'count': 'event_type.exact', 'limit': 10}
        params_trend = {'search': f"{search_query_class} AND {date_filter}", 'count': 'date_received'}
        
        if Config.OPENFDA_API_KEY:
            params_type['api_key'] = Config.OPENFDA_API_KEY
            params_trend['api_key'] = Config.OPENFDA_API_KEY

        resp_type = requests.get(base_url, params=params_type, timeout=10)
        if resp_type.status_code == 200:
            summary['event_types'] = resp_type.json().get('results', [])

        resp_trend = requests.get(base_url, params=params_trend, timeout=10)
        if resp_trend.status_code == 200:
            raw_dates = resp_trend.json().get('results', [])
            monthly_counts = {}
            for item in raw_dates:
                month_key = item.get('time', '')[:6]
                if month_key and len(month_key) == 6:
                    monthly_counts[month_key] = monthly_counts.get(month_key, 0) + item.get('count', 0)
            summary['trends'] = [{'time': k, 'count': v} for k, v in sorted(monthly_counts.items())]

    except Exception as e:
        logger.error(f"Error analyzing MAUDE data: {e}")
        return None

    return summary
