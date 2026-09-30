"""SAML POST -> one-use GET handoff binds login to its initiating browser.

The ACS deliberately never writes a Flask session: cross-site POSTs may not carry
the Lax session cookie. The GET handoff receives that cookie and verifies the
original flow before provisioning an account or establishing a login session.
"""
import json
import hashlib
import logging
import secrets
import time
from urllib.parse import urlencode, urlsplit

from flask import Blueprint, Response, jsonify, redirect, request, session
from flask_login import login_user

from dashboard.services import saml_service as saml
from dashboard.services.rate_limiter import rate_limit

logger = logging.getLogger(__name__)
saml_bp = Blueprint('saml', __name__)


@saml_bp.after_request
def private_response(response):
    response.headers['Cache-Control'] = 'no-store'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response


@saml_bp.route('/login')
@rate_limit('10 per minute')
def login():
    try:
        if saml.public_config()['sso_enabled']:
            canonical = saml.endpoint('/login')
            if urlsplit(request.host_url).hostname != urlsplit(canonical).hostname:
                # Start the flow on the same host as ACS so the browser-bound
                # session cookie will be available when login completes.
                return redirect(canonical + '?' + urlencode({'next': saml.safe_next(request.args.get('next'))}))
        auth = saml.toolkit()
        token = secrets.token_urlsafe(32)
        url = auth.login(return_to=token)
        saml.store().setex('saml:flow:' + token, saml.FLOW_TTL, json.dumps({
            'request_id': auth.get_last_request_id(), 'flow': token,
            'next': saml.safe_next(request.args.get('next')),
        }))
        session['saml_flow'] = token
        return redirect(url)
    except Exception:
        logger.exception('Unable to initiate SAML login')
        return jsonify(error='SSO is unavailable. Check deployment configuration or retry shortly.'), 503


def acs():
    try:
        if request.content_length and request.content_length > 2 * 1024 * 1024:
            raise ValueError('SAML response exceeds size limit')
        token = request.form.get('RelayState', '')
        if not token or len(token) > 128 or not request.form.get('SAMLResponse'):
            raise ValueError('Missing SAML login response')
        flow = saml.consume('saml:flow:' + token)
        if not flow:
            raise ValueError('Login request expired or already used. Start login again.')
        auth = saml.toolkit(request.form.to_dict())
        auth.process_response(request_id=flow['request_id'])
        if auth.get_errors() or not auth.is_authenticated():
            logger.warning('SAML validation failed: errors=%s reason=%s',
                           auth.get_errors(), (auth.get_last_error_reason() or '')[:1024])
            raise ValueError('SAML response validation failed')
        subject = auth.get_nameid()
        attrs = auth.get_attributes()
        email = attrs.get('Email', [])
        if not subject or len(subject) > 1024 or len(email) != 1 or not email[0] or len(email[0]) > 320:
            raise ValueError('SSO response is missing a valid NameID or Email attribute')
        # Always reject a message or assertion reused across different flows.
        cache = saml.store()
        ids = [auth.get_last_message_id(), auth.get_last_assertion_id()]
        if not all(ids):
            raise ValueError('SAML response is missing message IDs')
        expiry = auth.get_last_assertion_not_on_or_after()
        ttl = max(saml.FLOW_TTL, int(expiry - time.time()) + 120) if expiry else 86400
        # Atomic replay check of BOTH IDs; no partial reservation on failure.
        keys = ['saml:used:' + hashlib.sha256(value.encode()).hexdigest() for value in ids]
        ok = cache.eval("if redis.call('EXISTS',KEYS[1],KEYS[2])>0 then return 0 end; redis.call('SET',KEYS[1],'1','EX',ARGV[1]); redis.call('SET',KEYS[2],'1','EX',ARGV[1]); return 1", 2, *keys, ttl)
        if not ok:
            raise ValueError('SAML response was already used')
        handoff = secrets.token_urlsafe(32)
        flow['claims'] = {'issuer': auth.get_settings().get_idp_data()['entityId'], 'subject': subject,
                          'email': email[0], 'name': (attrs.get('Name') or [''])[0],
                          'office': (attrs.get('Office Info') or [''])[0]}
        cache.setex('saml:handoff:' + handoff, 60, json.dumps(flow))
        return redirect(saml.endpoint('/complete') + '?token=' + handoff, code=303)
    except Exception:
        logger.warning('Rejected SAML login response', exc_info=True)
        return jsonify(error='SSO login failed or expired. Please start login again.'), 400


@saml_bp.route('/complete')
def complete():
    try:
        token = request.args.get('token', '')
        if not token or len(token) > 128:
            raise ValueError('Invalid handoff')
        result = saml.consume('saml:handoff:' + token)
        if not result or not secrets.compare_digest(session.get('saml_flow', ''), result['flow']):
            raise ValueError('Login must finish in the browser that started it')
        user = saml.account(result['claims'])
        session.clear()
        login_user(user)
        session['auth_method'] = 'saml'
        return redirect(saml.safe_next(result['next']))
    except Exception:
        logger.warning('Unable to complete SAML login', exc_info=True)
        return jsonify(error='SSO login failed. Retry in the browser that started login, or contact an administrator.'), 400


@saml_bp.route('/metadata')
def metadata():
    try:
        from onelogin.saml2.settings import OneLogin_Saml2_Settings
        settings = OneLogin_Saml2_Settings(saml.settings(), sp_validation_only=True)
        xml = settings.get_sp_metadata()
        if settings.validate_metadata(xml):
            raise ValueError('Invalid SP metadata')
        return Response(xml, mimetype='application/samlmetadata+xml')
    except Exception:
        logger.exception('Unable to generate SP metadata')
        return jsonify(error='SSO metadata is unavailable. Check deployment configuration.'), 503
