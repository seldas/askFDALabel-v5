import time
import re
import threading
import logging
from functools import wraps
from collections import deque
from flask import request, jsonify, current_app

logger = logging.getLogger(__name__)

# Parse limit string e.g. "10 per minute", "5/second", "100 per hour", "1000/day"
def parse_rate_limit(limit_str: str):
    match = re.match(r'^\s*(\d+)\s*(?:/|per)\s*(second|sec|s|minute|min|m|hour|hr|h|day|d)\s*$', limit_str.strip().lower())
    if not match:
        raise ValueError(f"Invalid rate limit format: {limit_str}")
    count = int(match.group(1))
    unit = match.group(2)
    if unit in ('second', 'sec', 's'):
        period = 1
    elif unit in ('minute', 'min', 'm'):
        period = 60
    elif unit in ('hour', 'hr', 'h'):
        period = 3600
    elif unit in ('day', 'd'):
        period = 86400
    else:
        period = 60
    return count, period

class InMemoryRateLimiter:
    """Thread-safe sliding window in-memory rate limiter."""
    def __init__(self):
        self._lock = threading.Lock()
        self._storage = {}  # key -> deque of timestamps
        self._last_cleanup = time.time()

    def _cleanup_old_keys(self):
        now = time.time()
        if now - self._last_cleanup < 60:
            return
        self._last_cleanup = now
        dead_keys = []
        for key, timestamps in self._storage.items():
            # If newest timestamp is older than 1 day, drop key
            if not timestamps or now - timestamps[-1] > 86400:
                dead_keys.append(key)
        for k in dead_keys:
            self._storage.pop(k, None)

    def is_allowed(self, key: str, max_requests: int, window_seconds: int):
        with self._lock:
            now = time.time()
            self._cleanup_old_keys()
            
            if key not in self._storage:
                self._storage[key] = deque()
            
            timestamps = self._storage[key]
            
            # Evict timestamps outside current window
            threshold = now - window_seconds
            while timestamps and timestamps[0] <= threshold:
                timestamps.popleft()
            
            if len(timestamps) < max_requests:
                timestamps.append(now)
                return True, 0
            else:
                # Time until oldest request rolls out of the window
                retry_after = max(1, int(window_seconds - (now - timestamps[0])))
                return False, retry_after

_memory_limiter = InMemoryRateLimiter()
_redis_client = None
_redis_initialized = False

def get_redis_client():
    global _redis_client, _redis_initialized
    if _redis_initialized:
        return _redis_client
    
    _redis_initialized = True
    try:
        import redis
        from dashboard.config import Config
        broker_url = getattr(Config, 'CELERY_BROKER_URL', 'redis://localhost:6379/0')
        client = redis.Redis.from_url(broker_url, socket_timeout=1, socket_connect_timeout=1)
        client.ping()
        _redis_client = client
        logger.info("RateLimiter: Connected to Redis storage.")
    except Exception as e:
        logger.info(f"RateLimiter: Redis not available ({e}), falling back to in-memory limiter.")
        _redis_client = None
    return _redis_client

def get_client_identifier():
    """Returns unique identifier for client (IP address)."""
    # X-Forwarded-For is handled by ProxyFix in app.py
    return request.remote_addr or '127.0.0.1'

def rate_limit(limit: str = None, key_func=None):
    """
    Decorator to apply rate limiting to Flask routes.
    Example: @rate_limit('10 per minute')
    """
    def decorator(f):
        @wraps(f)
        def wrapped(*args, **kwargs):
            try:
                enabled = current_app.config.get('RATELIMIT_ENABLED', True)
            except Exception:
                enabled = True
                
            if not enabled:
                return f(*args, **kwargs)
                
            limit_str = limit or current_app.config.get('RATELIMIT_DEFAULT', '120 per minute')
            try:
                max_req, window = parse_rate_limit(limit_str)
            except ValueError:
                max_req, window = 120, 60

            ident = key_func() if key_func else get_client_identifier()
            endpoint = request.endpoint or f.__name__
            key = f"rl:{endpoint}:{ident}"

            redis_conn = get_redis_client()
            allowed = True
            retry_after = 0

            if redis_conn:
                try:
                    now = time.time()
                    pipe = redis_conn.pipeline()
                    # Sliding window in Redis using sorted set
                    pipe.zremrangebyscore(key, 0, now - window)
                    pipe.zadd(key, {str(now): now})
                    pipe.zcard(key)
                    pipe.expire(key, window + 1)
                    results = pipe.execute()
                    
                    current_count = results[2]
                    if current_count > max_req:
                        allowed = False
                        retry_after = window
                except Exception as e:
                    logger.debug(f"Redis rate limit check error: {e}, using memory limiter.")
                    allowed, retry_after = _memory_limiter.is_allowed(key, max_req, window)
            else:
                allowed, retry_after = _memory_limiter.is_allowed(key, max_req, window)

            if not allowed:
                response = jsonify({
                    'success': False,
                    'error': f'Too many requests. Please slow down and try again in {retry_after} seconds.',
                    'retry_after': retry_after
                })
                response.status_code = 429
                response.headers['Retry-After'] = str(retry_after)
                return response

            return f(*args, **kwargs)
        return wrapped
    return decorator
