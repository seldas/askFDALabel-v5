"""
Route guards shared across the dashboard blueprints.

Kept separate from any one blueprint so query history (api.py) and preferences
(main.py) enforce the guest restriction through the same check rather than two
copies of a username comparison that could drift apart.
"""

from functools import wraps

from flask import jsonify
from flask_login import current_user


#: Sent back when the guest account touches a feature reserved for real
#: accounts. 403 rather than 401: the request is authenticated, it is the
#: account that is not permitted, so the client should not prompt to log in
#: again -- it should prompt to register.
GUEST_FORBIDDEN_MESSAGE = (
    'This feature is not available for the guest account. '
    'Please register or sign in to use it.'
)


def guest_forbidden(f):
    """
    Rejects the shared anonymous account.

    For per-user features -- query history, saved preferences -- where the guest
    row being shared by every anonymous visitor means one visitor would read and
    overwrite another's data. Hiding the entry points in the UI is not enough on
    its own; these routes are reachable directly.

    Apply *below* @login_required so an anonymous request still gets a 401
    rather than this 403.
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if current_user.is_authenticated and current_user.is_guest:
            return jsonify({
                'success': False,
                'error': GUEST_FORBIDDEN_MESSAGE,
                'is_guest': True,
            }), 403
        return f(*args, **kwargs)
    return decorated_function


#: Sent back when a plain user reaches a developer-only module.
DEVELOPER_ONLY_MESSAGE = (
    'This tool is available to developer and admin accounts only. '
    'Contact an administrator to request access.'
)


def _developer_access_denied():
    return jsonify({
        'success': False,
        'error': DEVELOPER_ONLY_MESSAGE,
        'developer_only': True,
    }), 403


def require_developer_access():
    """
    Blueprint-level gate for developer-only modules.

    Registered as a `before_request` on the whole blueprint rather than applied
    per route, so a route added later is covered by default instead of being
    forgotten. Returns None to let the request through.

    Unauthenticated callers get 401 so the client prompts to sign in; an
    authenticated plain user gets 403, because signing in again will not help.
    """
    if not current_user.is_authenticated:
        return jsonify({
            'success': False,
            'error': 'Authentication required.',
        }), 401
    if not current_user.has_developer_access:
        return _developer_access_denied()
    return None


def developer_required(f):
    """Single-route form of :func:`require_developer_access`."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        denied = require_developer_access()
        if denied is not None:
            return denied
        return f(*args, **kwargs)
    return decorated_function
