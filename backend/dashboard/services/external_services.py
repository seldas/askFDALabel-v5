"""Cached server-side probes; timeouts do not establish that a service is offline."""
import os
from concurrent.futures import ThreadPoolExecutor
from threading import Lock
from time import monotonic

import requests
from werkzeug.exceptions import ServiceUnavailable

_URLS = {
    'openfda': 'https://api.fda.gov/drug/event.json',
    'dailymed': 'https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json?pagesize=1',
}
_cache = {}
_locks = {name: Lock() for name in _URLS}


def service_status(name):
    with _locks[name]:
        cached = _cache.get(name)
        if cached and monotonic() < cached[0]:
            return dict(cached[1])
        result = None
        params = None
        if name == 'openfda':
            params = {'limit': 1}
            api_key = os.getenv('OPENFDA_API_KEY', '')
            if api_key:
                params['api_key'] = api_key
        # Confirm network failure once before declaring the service unavailable.
        for _ in range(2):
            try:
                with requests.get(_URLS[name], params=params, timeout=(5, 15), stream=True) as response:
                    status = response.status_code
                    if status == 200 and 'json' in response.headers.get('Content-Type', '').lower():
                        result = {'status': 'available', 'message': ''}
                    elif status in (401, 403) or status == 200:
                        result = {'status': 'unavailable', 'message': f'This server cannot access {name}: HTTP {status} or an unexpected non-JSON response.'}
                        continue
                    else:
                        result = {'status': 'degraded', 'message': f'{name} returned HTTP {status}; requests may fail or be rate limited.'}
                    break
            except requests.Timeout:
                # A slow response is not evidence that live requests cannot work.
                result = {'status': 'degraded', 'message': f'The {name} connectivity check timed out. Live retrieval remains enabled but may be slow.'}
                break
            except requests.ConnectionError:
                result = {'status': 'unavailable', 'message': f'This server cannot reach {name}.'}
            except requests.RequestException:
                result = {'status': 'degraded', 'message': f'The {name} connectivity check failed. Live retrieval remains enabled; try again if a request fails.'}
                break
        _cache[name] = (monotonic() + (300 if result['status'] == 'available' else 60), result)
        return dict(result)


def external_service_statuses():
    with ThreadPoolExecutor(max_workers=2) as executor:
        return dict(zip(_URLS, executor.map(service_status, _URLS)))


def require_service(name):
    if service_status(name)['status'] == 'unavailable':
        raise ServiceUnavailable(description=f'This server cannot reach {name}. Live data retrieval is temporarily disabled. Try again later; saved results remain available.')
