"""Short, cached server-side probes; independent from account feature gates."""
from concurrent.futures import ThreadPoolExecutor
from threading import Lock
from time import monotonic

import requests
from werkzeug.exceptions import ServiceUnavailable

_URLS = {
    'openfda': 'https://api.fda.gov/drug/event.json?limit=1',
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
        # Confirm network failure once before declaring the service unavailable.
        for _ in range(2):
            try:
                with requests.get(_URLS[name], timeout=(1.5, 2), stream=True) as response:
                    status = response.status_code
                    if status == 200 and 'json' in response.headers.get('Content-Type', '').lower():
                        result = {'status': 'available', 'message': ''}
                    elif status in (401, 403) or status == 200:
                        result = {'status': 'unavailable', 'message': f'This server cannot access {name}: HTTP {status} or an unexpected non-JSON response.'}
                        continue
                    else:
                        result = {'status': 'degraded', 'message': f'{name} returned HTTP {status}; requests may fail or be rate limited.'}
                    break
            except requests.RequestException:
                result = {'status': 'unavailable', 'message': f'This server cannot reach {name}.'}
        _cache[name] = (monotonic() + (300 if result['status'] == 'available' else 60), result)
        return dict(result)


def external_service_statuses():
    with ThreadPoolExecutor(max_workers=2) as executor:
        return dict(zip(_URLS, executor.map(service_status, _URLS)))


def require_service(name):
    if service_status(name)['status'] == 'unavailable':
        raise ServiceUnavailable(description=f'This server cannot reach {name}. Live data retrieval is temporarily disabled. Try again later; saved results remain available.')
