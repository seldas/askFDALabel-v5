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
