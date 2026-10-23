import os
from flask import Blueprint, request, jsonify
from flask_login import login_user, login_required, logout_user, current_user
from database import db, User, ROLE_USER, utc_now
from dashboard.services import feature_gates
from dashboard.services.rate_limiter import rate_limit
import logging

logger = logging.getLogger(__name__)

auth_bp = Blueprint('auth', __name__)

@auth_bp.route('/login', methods=['POST'])
@rate_limit('10 per minute')
def login():
    if current_user.is_authenticated:
        if (current_user.username or '').lower() == 'guest':
            logout_user()
        else:
            return jsonify({'success': True, 'message': 'Already authenticated'})

    data = request.get_json()
    if not data:
        return jsonify({'success': False, 'error': 'Missing JSON data'}), 400

    username = (data.get('username') or '').strip().lower()
    password = data.get('password')

    if not username or not password or username == 'guest':
        return jsonify({'success': False, 'error': 'Invalid username or password'}), 401

    user = User.query.filter(db.func.lower(User.username) == username.lower()).first()
    if user and user.check_password(password):
        if hasattr(user, 'is_active') and getattr(user, 'is_active') is False:
            return jsonify({'success': False, 'error': 'Account has been deactivated. Please contact an administrator.'}), 401
            
        user.last_login = utc_now()
        db.session.commit()
        login_user(user)
        return jsonify({
            'success': True,
            'user': {
                'id': user.id,
                'username': user.username,
                'is_admin': user.is_admin,
                'role': user.effective_role,
                'can_select_db': user.can_select_database,
                'has_developer_access': user.has_developer_access,
                'is_guest': user.is_guest
            }
        })
    else:
        return jsonify({'success': False, 'error': 'Invalid username or password'}), 401

@auth_bp.route('/register', methods=['POST'])
@rate_limit('5 per minute')
def register():
    return jsonify({
        'success': False,
        'error': 'Self-registration is disabled. Please sign in with an existing account or contact an administrator.',
    }), 403

@auth_bp.route('/logout')
@login_required
def logout():
    logout_user()
    return jsonify({'success': True})

@auth_bp.route('/guest-login', methods=['POST'])
@rate_limit('15 per minute')
def guest_login():
    return jsonify({
        'success': False,
        'error': 'Guest login has been disabled. Please use Single Sign-On (SSO) to sign in.'
    }), 403

@auth_bp.route('/change_password', methods=['POST'])
@login_required
@rate_limit('5 per minute')
def change_password():
    if (current_user.username or '').lower() == 'guest':
        return jsonify({'success': False, 'error': 'Guest account cannot change password'}), 403

    data = request.get_json()
    if not data:
        return jsonify({'success': False, 'error': 'Missing JSON data'}), 400

    new_password = data.get('password')

    if not new_password:
        return jsonify({'success': False, 'error': 'Password cannot be empty'}), 400

    if current_user.sso_identities:
        return jsonify({'success': False, 'error': 'SSO passwords are managed by the identity provider.'}), 403
    
    current_user.set_password(new_password)
    db.session.commit()
    
    return jsonify({'success': True})

@auth_bp.route('/session')
def session():
    """ Returns current user info as JSON. """
    from dashboard.services.ai_handler import _check_is_internal
    from dashboard.services.saml_service import public_config
    try:
        is_internal = _check_is_internal()
    except Exception as e:
        logger.error(f"Error checking internal status: {e}")
        is_internal = False
    
    from dashboard.services.ai_preferences import allowed_providers as get_allowed, resolve_provider, public_catalog, connection_config, normalize_provider
    allowed_providers = get_allowed()
    if current_user.is_authenticated:
        if current_user.is_guest:
            logout_user()
            return jsonify({
                **public_config(),
                'is_authenticated': False,
                'is_internal': is_internal,
            })
        effective_provider, default_provider = resolve_provider(current_user)
        effective_config = connection_config(effective_provider, current_user)
        preference = normalize_provider(current_user.ai_provider)
        if current_user.is_guest or preference not in allowed_providers:
            preference = ''
        return jsonify({
            **public_config(),
            'auth_method': 'saml' if current_user.sso_identities else 'password',
            'display_name': current_user.display_name,
            'is_authenticated': True,
            'id': current_user.id,
            'username': current_user.username,
            'is_admin': current_user.is_admin,
            'role': current_user.effective_role,
            'can_comment': getattr(current_user, 'can_comment', True),
            # Whether the database switch is offered at all. Normal users are
            # pinned to the CDER-CBER scope; see labelquery._resolve_target_db,
            # which enforces the same rule server-side.
            'can_select_db': current_user.can_select_database,
            # LabelChat, Web-test and Local Database Search. The blueprints
            # behind all three refuse a plain user, so this only decides
            # whether the entry points are offered.
            'has_developer_access': current_user.has_developer_access,
            # Per-feature verdicts from the same resolver the routes use, so
            # the UI hides exactly what the backend would refuse. Resolved per
            # request, so an admin's change lands on the next session fetch.
            'permissions': feature_gates.permissions_for(current_user),
            # Query history and saved preferences are per-user state on a row
            # every anonymous visitor shares, so both are closed to the guest
            # account. Enforced on the routes as well as hidden in the UI.
            'is_guest': current_user.is_guest,
            'ai_provider': effective_provider,
            'ai_preference': preference,
            'ai_model_name': effective_config.get('model_id') or effective_config.get('model_name', ''),
            'ai_default_provider': default_provider,
            'ai_models': public_catalog(),
            'custom_gemini_key': current_user.custom_gemini_key if current_user.is_admin and not is_internal else '',
            'openai_api_key': current_user.openai_api_key if current_user.is_admin else '',
            'openai_base_url': current_user.openai_base_url if current_user.is_admin else '',
            'openai_model_name': current_user.openai_model_name if current_user.is_admin else '',
            'ai_settings': current_user.ai_settings if current_user.is_admin else None,
            'is_internal': is_internal,
            'api_key': getattr(current_user, 'api_key', None),
            'gemini_model': '' if is_internal else os.environ.get('GEMINI_MODEL', 'Gemini'),
            'gemini_fallback_model': '' if is_internal else os.environ.get('GEMINI_FALLBACK_MODEL', ''),
            'env_elsa_url': os.getenv("ELSA_API_URL", ""),
            'env_elsa_user': os.getenv("ELSA_API_NAME", ""),
            'has_elsa_key': bool(os.getenv("ELSA_API_KEY")),
            'env_elsa_model_id': os.getenv("ELSA_MODEL_ID", ""),
            'env_elsa_model_name': os.getenv("ELSA_MODEL_NAME", ""),
            'env_vllm_url': os.getenv("LLM_URL", ""),
            'env_vllm_model': os.getenv("LLM_MODEL", ""),
            'env_ollama_url': os.getenv("OLLAMA_URL", ""),
            'has_gemini_key': False if is_internal else bool(os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")),
            'api_server_host': os.getenv("API_SERVER_HOST") or os.getenv("DEV_SERVER_HOST") or "ncshpcgpu01.fda.gov",
            'allowed_ai_providers': allowed_providers
        })
    return jsonify({
        **public_config(),
        'is_authenticated': False,
        'is_internal': is_internal,
        'api_server_host': os.getenv("API_SERVER_HOST") or os.getenv("DEV_SERVER_HOST") or "ncshpcgpu01.fda.gov",
        'allowed_ai_providers': allowed_providers
    })


@auth_bp.route('/api-key', methods=['GET'])
@login_required
def get_api_key():
    """Returns the current user's API key."""
    if current_user.is_guest:
        return jsonify({'error': 'API key generation is not available for guest accounts.'}), 403
    return jsonify({
        'success': True,
        'api_key': getattr(current_user, 'api_key', None)
    })


@auth_bp.route('/api-key/generate', methods=['POST'])
@login_required
def generate_api_key():
    """Generates a new API key for the current user (rotating any existing key)."""
    if current_user.is_guest:
        return jsonify({'error': 'API key generation is not available for guest accounts.'}), 403
    
    key = current_user.generate_api_key()
    db.session.commit()
    return jsonify({
        'success': True,
        'api_key': key,
        'message': 'New API key generated successfully.'
    })


@auth_bp.route('/api-key', methods=['DELETE'])
@login_required
def revoke_api_key():
    """Revokes the current user's API key."""
    if current_user.is_guest:
        return jsonify({'error': 'Guest accounts do not have API keys.'}), 403
    
    current_user.api_key = None
    current_user.api_key_created_at = None
    current_user.api_key_last_used = None
    db.session.commit()
    return jsonify({
        'success': True,
        'message': 'API key revoked successfully.'
    })

