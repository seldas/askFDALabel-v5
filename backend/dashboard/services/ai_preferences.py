"""One model catalog for preferences, sessions, and AI request routing."""
import os
import json

_STATIC_MODEL_NAMES = {'elsa': 'ELSA', 'gemini': 'Gemini'}
_LOCAL_SLOTS = {
    'local-1': ('LOCAL_LLM_1', 'LLM', 'Llama-4 (Local)'),
    'local-2': ('LOCAL_LLM_2', 'MUSE_LLM', 'Muse (Local)'),
}
_LEGACY_PROVIDER_MAP = {
    'llama': 'local-1',
    'vllm': 'local-1',
    'llama-4': 'local-1',
    'local_1': 'local-1',
    'muse': 'local-2',
    'local_2': 'local-2',
}
_LEGACY_SETTINGS_KEYS = {
    'local-1': ('local-1', 'llama-4', 'llama', 'vllm'),
    'local-2': ('local-2', 'muse'),
}


def _env_first(*keys, default=''):
    for key in keys:
        val = os.getenv(key)
        if val is not None and val.strip() != '':
            return val.strip()
    return default


def _slot_enabled(slot):
    prefix, legacy_prefix, _ = _LOCAL_SLOTS[slot]
    url = _env_first(f'{prefix}_URL', f'{legacy_prefix}_URL')
    raw = os.getenv(f'{prefix}_ENABLED', '').strip().lower()
    if raw in ('false', '0', 'no', 'off'):
        return False
    if raw in ('true', '1', 'yes', 'on'):
        return True
    return bool(url)


def provider_display_name(provider):
    if provider in _LOCAL_SLOTS:
        prefix, _, default_name = _LOCAL_SLOTS[provider]
        return os.getenv(f'{prefix}_NAME', '').strip() or default_name
    return _STATIC_MODEL_NAMES.get(provider, provider)


def normalize_provider(value):
    value = value.strip().lower() if isinstance(value, str) else ''
    return _LEGACY_PROVIDER_MAP.get(value, value)


def allowed_providers():
    from dashboard.services.ai_handler import _check_is_internal
    internal = _check_is_internal()
    if internal:
        candidates = ['elsa'] + [slot for slot in ('local-1', 'local-2') if _slot_enabled(slot)]
    else:
        candidates = ['gemini']
    configured = os.getenv('ALLOWED_AI_PROVIDERS')
    if configured:
        allowed = {normalize_provider(p) for p in configured.split(',')}
        candidates = [p for p in candidates if p in allowed]
    return candidates


def resolve_provider(user=None):
    allowed = allowed_providers()
    if not allowed:
        raise ValueError('No AI models are enabled for this deployment.')
    default = normalize_provider(os.getenv('DEFAULT_AI_MODEL'))
    if default not in allowed:
        default = allowed[0]
    personal = bool(user and user.is_authenticated and not user.is_guest)
    selected = normalize_provider(user.ai_provider) if personal else ''
    return selected if selected in allowed else default, default


def model_defaults(provider):
    if provider == 'elsa':
        return dict(url=os.getenv('ELSA_API_URL', ''), user=os.getenv('ELSA_API_NAME', ''),
                    key=os.getenv('ELSA_API_KEY', ''), model_id=os.getenv('ELSA_MODEL_ID', ''),
                    model_name=os.getenv('ELSA_MODEL_NAME', 'CLAUDE_4_SONNET'))
    if provider == 'gemini':
        return dict(api_key=os.getenv('GEMINI_API_KEY') or os.getenv('GOOGLE_API_KEY', ''),
                    model_name=os.getenv('GEMINI_MODEL', 'gemini-3.5-flash-lite'))
    if provider in _LOCAL_SLOTS:
        prefix, legacy_prefix, _ = _LOCAL_SLOTS[provider]
        return dict(
            url=_env_first(f'{prefix}_URL', f'{legacy_prefix}_URL'),
            api_key=_env_first(f'{prefix}_KEY', f'{legacy_prefix}_KEY'),
            model_name=_env_first(f'{prefix}_MODEL', f'{legacy_prefix}_MODEL'),
        )
    return {}


def public_catalog():
    return [dict(id=p, name=provider_display_name(p), model=model_defaults(p).get('model_id') or model_defaults(p).get('model_name', ''))
            for p in allowed_providers()]


def connection_config(provider, user=None):
    """Only administrators may override deployment connections."""
    defaults = model_defaults(provider)
    if not (user and user.is_authenticated and user.is_admin and not user.is_guest):
        return defaults
    try:
        settings = json.loads(user.ai_settings or '{}')
        if not isinstance(settings, dict):
            settings = {}
    except (ValueError, TypeError):
        settings = {}
    options = {}
    for candidate_key in _LEGACY_SETTINGS_KEYS.get(provider, (provider,)):
        if isinstance(settings.get(candidate_key), dict):
            options = settings[candidate_key]
            break
    if provider == 'gemini' and 'api_key' not in options:
        options = {**options, 'api_key': getattr(user, 'custom_gemini_key', '')}
    # Generic OpenAI / vllm settings may belong to another local engine.
    # Only explicitly named model overrides may replace deployment defaults.
    return {key: options.get(key) or value for key, value in defaults.items()}
