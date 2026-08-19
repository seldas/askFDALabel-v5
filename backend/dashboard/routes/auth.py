import os
import re
from flask import Blueprint, request, jsonify
from flask_login import login_user, login_required, logout_user, current_user
from database import db, User, ROLE_USER
import logging

logger = logging.getLogger(__name__)

auth_bp = Blueprint('auth', __name__)

@auth_bp.route('/login', methods=['POST'])
def login():
    if current_user.is_authenticated:
        if (current_user.username or '').lower() == 'guest':
            logout_user()
        else:
            return jsonify({'success': True, 'message': 'Already authenticated'})

    data = request.get_json()
    if not data:
        return jsonify({'success': False, 'error': 'Missing JSON data'}), 400

    username = (data.get('username') or '').strip()
    password = data.get('password')

    if not username or not password:
        return jsonify({'success': False, 'error': 'Invalid username or password'}), 401

    user = User.query.filter(db.func.lower(User.username) == username.lower()).first()
    if user and user.check_password(password):
        if hasattr(user, 'is_active') and getattr(user, 'is_active') is False:
            return jsonify({'success': False, 'error': 'Account has been deactivated. Please contact an administrator.'}), 401
            
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
def register():
    if current_user.is_authenticated:
        if (current_user.username or '').lower() == 'guest':
            logout_user()
        else:
            return jsonify({'success': True, 'message': 'Already authenticated'})

    data = request.get_json()
    if not data:
        return jsonify({'success': False, 'error': 'Missing JSON data'}), 400

    username = data.get('username', '').strip()
    password = data.get('password')
    
    if not username:
        return jsonify({'success': False, 'error': 'Username is required'}), 400
        
    if not re.match(r'^[a-zA-Z0-9.@_\+-]+$', username):
        return jsonify({
            'success': False, 
            'error': 'Invalid username. Use only letters, numbers, and . @ _ - + (no spaces)'
        }), 400

    if User.query.filter(db.func.lower(User.username) == username.lower()).first():
        return jsonify({'success': False, 'error': 'Username already exists'}), 400
    
    new_user = User(username=username)
    new_user.set_role(ROLE_USER)
    new_user.set_password(password)
    db.session.add(new_user)
    db.session.commit()
    
    login_user(new_user)
    return jsonify({'success': True})

@auth_bp.route('/logout')
@login_required
def logout():
    logout_user()
    return jsonify({'success': True})

@auth_bp.route('/guest-login', methods=['POST'])
def guest_login():
    if current_user.is_authenticated:
        return jsonify({'success': True, 'message': 'Already authenticated'})
        
    guest_user = User.query.filter(db.func.lower(User.username) == 'guest').first()
    if not guest_user:
        guest_user = User(username='guest')
        guest_user.set_role(ROLE_USER)
        guest_user.set_password('guest')
        db.session.add(guest_user)
        db.session.commit()
        
    login_user(guest_user)
    return jsonify({
        'success': True,
        'user': {
            'id': guest_user.id,
            'username': guest_user.username,
            'is_admin': guest_user.is_admin,
            'role': guest_user.effective_role,
            'can_select_db': guest_user.can_select_database,
            'has_developer_access': guest_user.has_developer_access,
            'is_guest': guest_user.is_guest
        }
    })

@auth_bp.route('/change_password', methods=['POST'])
@login_required
def change_password():
    if (current_user.username or '').lower() == 'guest':
        return jsonify({'success': False, 'error': 'Guest account cannot change password'}), 403

    data = request.get_json()
    if not data:
        return jsonify({'success': False, 'error': 'Missing JSON data'}), 400

    new_password = data.get('password')

    if not new_password:
        return jsonify({'success': False, 'error': 'Password cannot be empty'}), 400
    
    current_user.set_password(new_password)
    db.session.commit()
    
    return jsonify({'success': True})

@auth_bp.route('/session')
def session():
    """ Returns current user info as JSON. """
    from dashboard.services.ai_handler import _check_is_internal
    try:
        is_internal = _check_is_internal()
    except Exception as e:
        logger.error(f"Error checking internal status: {e}")
        is_internal = False
    
    if current_user.is_authenticated:
        return jsonify({
            'is_authenticated': True,
            'id': current_user.id,
            'username': current_user.username,
            'is_admin': current_user.is_admin,
            'role': current_user.effective_role,
            # Whether the database switch is offered at all. Normal users are
            # pinned to the CDER-CBER scope; see labelquery._resolve_target_db,
            # which enforces the same rule server-side.
            'can_select_db': current_user.can_select_database,
            # LabelChat, Web-test and Local Database Search. The blueprints
            # behind all three refuse a plain user, so this only decides
            # whether the entry points are offered.
            'has_developer_access': current_user.has_developer_access,
            # Query history and saved preferences are per-user state on a row
            # every anonymous visitor shares, so both are closed to the guest
            # account. Enforced on the routes as well as hidden in the UI.
            'is_guest': current_user.is_guest,
            'ai_provider': current_user.ai_provider or os.getenv("DEFAULT_AI_MODEL") or ('elsa' if is_internal else 'gemini'),
            'custom_gemini_key': current_user.custom_gemini_key,
            'openai_api_key': current_user.openai_api_key,
            'openai_base_url': current_user.openai_base_url,
            'openai_model_name': current_user.openai_model_name,
            'ai_settings': current_user.ai_settings,
            'is_internal': is_internal,
            'gemini_model': os.environ.get('GEMINI_MODEL', 'Gemini'),
            'gemini_fallback_model': os.environ.get('GEMINI_FALLBACK_MODEL', ''),
            'env_elsa_url': os.getenv("ELSA_API_URL", ""),
            'env_elsa_user': os.getenv("ELSA_API_NAME", ""),
            'has_elsa_key': bool(os.getenv("ELSA_API_KEY")),
            'env_elsa_model_id': os.getenv("ELSA_MODEL_ID", ""),
            'env_elsa_model_name': os.getenv("ELSA_MODEL_NAME", ""),
            'env_vllm_url': os.getenv("LLM_URL", ""),
            'env_vllm_model': os.getenv("LLM_MODEL", ""),
            'env_ollama_url': os.getenv("OLLAMA_URL", ""),
            'has_gemini_key': bool(os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")),
            'has_vllm_key': bool(os.getenv("LLM_KEY"))
        })
    return jsonify({
        'is_authenticated': False,
        'is_internal': is_internal
    })
