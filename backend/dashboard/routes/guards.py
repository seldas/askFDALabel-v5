"""
Route guards shared across the dashboard blueprints.

Every guard here resolves against the feature-gate table rather than a
hardcoded role, so an admin can move a feature between roles from the
management panel and the change applies to the next request -- no restart. See
dashboard.services.feature_gates for why nothing is cached across requests.
"""

from functools import wraps

from flask import jsonify
from flask_login import current_user

from dashboard.services import feature_gates


#: Sent back when the guest account touches a feature reserved for real
#: accounts. 403 rather than 401: the request is authenticated, it is the
#: account that is not permitted, so the client should not prompt to log in
#: again -- it should prompt to register.
GUEST_FORBIDDEN_MESSAGE = (
    'This feature is not available for the guest account. '
    'Please register or sign in to use it.'
)


def require_feature(key):
    """
    Decorator factory gating a route on a feature key.

    The refusal distinguishes the two reasons so the client can say something
    useful: an account excluded because it is the shared guest gets the guest
    message, anything else gets the role message.

    Apply *below* @login_required where the route has it, so an anonymous
    request still gets a 401 rather than a 403.
    """
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            denied = _feature_denied(key)
            if denied is not None:
                return denied
            return f(*args, **kwargs)
        return decorated_function
    return decorator


def _feature_denied(key):
    """Refusal response for `key`, or None when the request may proceed."""
    if not current_user.is_authenticated:
        return jsonify({
            'success': False,
            'error': 'Authentication required.',
        }), 401

    if feature_gates.is_allowed(current_user, key):
        return None

    spec = feature_gates.get_spec(key)
    gate = feature_gates.gate_for(key) or {}
    if getattr(current_user, 'is_guest', False) and not gate.get('allow_guest', False):
        return jsonify({
            'success': False,
            'error': GUEST_FORBIDDEN_MESSAGE,
            'is_guest': True,
            'feature': key,
        }), 403

    return jsonify({
        'success': False,
        'error': DEVELOPER_ONLY_MESSAGE.format(
            role=(gate.get('min_role') or 'developer'),
            name=(spec.name if spec else key),
        ),
        'developer_only': True,
        'feature': key,
    }), 403


#: Sent back when a plain user reaches a developer-only module.
#: Formatted with the gate's current role and the feature's name, so the
#: message tracks whatever the admin set rather than naming 'developer' when
#: the gate now says something else.
DEVELOPER_ONLY_MESSAGE = (
    '{name} is available to {role} accounts and above. '
    'Contact an administrator to request access.'
)


def feature_before_request(key):
    """
    Blueprint-level gate, for modules where every route is gated alike.

    Registered as a `before_request` on the whole blueprint rather than applied
    per route, so a route added later is covered by default instead of being
    forgotten:

        search_bp.before_request(feature_before_request('labelchat'))

    Returns None to let the request through.
    """
    def _check():
        return _feature_denied(key)
    _check.__name__ = f'require_feature_{key}'
    return _check
