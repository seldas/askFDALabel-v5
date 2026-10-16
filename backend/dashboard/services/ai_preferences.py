"""One model catalog for preferences, sessions, and AI request routing."""
import os
import json

MODEL_NAMES = {'elsa': 'ELSA', 'llama-4': 'Llama-4 (Local)', 'muse': 'Muse (Local)', 'gemini': 'Gemini'}


def normalize_provider(value):
    value = value.strip().lower() if isinstance(value, str) else ''
    return {'llama': 'llama-4', 'vllm': 'llama-4'}.get(value, value)


def allowed_providers():
    from dashboard.services.ai_handler import _check_is_internal
    internal = _check_is_internal()
    candidates = ['elsa', 'llama-4', 'muse'] if internal else ['gemini']
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
    prefix = 'MUSE_LLM' if provider == 'muse' else 'LLM'
    return dict(url=os.getenv(prefix + '_URL', ''), api_key=os.getenv(prefix + '_KEY', ''),
                model_name=os.getenv(prefix + '_MODEL', ''))


def public_catalog():
    return [dict(id=p, name=MODEL_NAMES[p], model=model_defaults(p).get('model_id') or model_defaults(p).get('model_name', ''))
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
    options = settings.get(provider, {})
    if provider == 'llama-4':
        options = settings.get(provider, settings.get('vllm', settings.get('llama', {})))
    if not isinstance(options, dict):
        options = {}
    # Preserve older administrator profiles until they save the new form.
    legacy = {}
    if provider == 'llama-4':
        legacy = dict(url=getattr(user, 'openai_base_url', ''),
                      api_key=getattr(user, 'openai_api_key', ''),
                      model_name=getattr(user, 'openai_model_name', ''))
    elif provider == 'gemini':
        legacy = dict(api_key=getattr(user, 'custom_gemini_key', ''))
    options = {**{k: v for k, v in legacy.items() if v}, **options}
    return {key: options.get(key) or value for key, value in defaults.items()}
