"""Strict SP settings, shared one-use flow state and SSO account provisioning."""
import hashlib
import json
import os
from pathlib import Path
from urllib.parse import urlsplit

import redis
import requests
from flask import current_app
from sqlalchemy.exc import IntegrityError

from database import db, User, ROLE_USER, utc_now
from database.models import SsoIdentity

AUTH_PATH = '/api/dashboard/auth/saml'
FLOW_TTL = 300


def public_config():
    provider = os.getenv('SSO_PROVIDER', 'disabled')
    configured = provider in ('keycloak', 'fda') and all(os.getenv(k) for k in (
        'SSO_PUBLIC_ORIGIN', 'SAML_SP_ENTITY_ID', 'SAML_ACS_URL'))
    return {'sso_enabled': bool(configured), 'sso_provider': provider,
            'sso_label': 'FDA SSO' if provider == 'fda' else 'Test SSO (Keycloak)'}


def store():
    return redis.Redis.from_url(os.getenv('SAML_REDIS_URL') or current_app.config['CELERY_BROKER_URL'], decode_responses=True,
                               socket_connect_timeout=3, socket_timeout=3)


def consume(key):
    # Lua works with Redis versions predating GETDEL and is atomic across workers.
    value = store().eval("local v=redis.call('GET',KEYS[1]); if v then redis.call('DEL',KEYS[1]); end; return v", 1, key)
    return json.loads(value) if value else None


def endpoint(suffix):
    return os.environ['SSO_PUBLIC_ORIGIN'].rstrip('/') + os.getenv('SSO_API_BASE', '/fdalabel-v3_api').rstrip('/') + AUTH_PATH + suffix


def safe_next(value):
    base = os.getenv('SSO_APP_BASE', '/fdalabel-v3').rstrip('/')
    value = value or base + '/'
    parsed = urlsplit(value)
    if (parsed.scheme or parsed.netloc or not value.startswith('/') or value.startswith('//')
            or '\\' in value or any(ord(c) < 32 for c in value)
            or (base and parsed.path != base and not parsed.path.startswith(base + '/'))):
        return base + '/'
    return value


def settings():
    from onelogin.saml2.idp_metadata_parser import OneLogin_Saml2_IdPMetadataParser
    if not public_config()['sso_enabled']:
        raise ValueError('SSO is not configured. Set the registered SP Entity ID, ACS URL and public origin.')
    if os.environ['SSO_PROVIDER'] == 'fda':
        default = Path(__file__).resolve().parents[3] / 'deploy' / 'SSO_config' / 'sso2.xml'
        xml = Path(os.getenv('SAML_IDP_METADATA_FILE', str(default))).read_text(encoding='utf-8')
    else:
        # The trusted URL is deployment configuration, never request input.
        response = requests.get(os.environ['SAML_IDP_METADATA_URL'], timeout=5)
        response.raise_for_status()
        xml = response.text
    idp = OneLogin_Saml2_IdPMetadataParser.parse(xml, entity_id=os.getenv('SAML_IDP_ENTITY_ID') or None)
    if not idp.get('idp', {}).get('x509cert') and not idp.get('idp', {}).get('x509certMulti'):
        raise ValueError('IdP metadata has no trusted signing certificate')
    if os.environ['SSO_PROVIDER'] == 'keycloak':
        # Internal metadata fetch address and browser-facing issuer may differ.
        if idp['idp']['entityId'] != os.environ['SAML_IDP_ENTITY_ID']:
            raise ValueError('Keycloak metadata issuer does not match KEYCLOAK_PUBLIC_URL')
    sp = {'entityId': os.environ['SAML_SP_ENTITY_ID'],
          'assertionConsumerService': {'url': os.environ['SAML_ACS_URL'], 'binding': 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST'},
          'NameIDFormat': 'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified'}
    cert_path, key_path = os.getenv('SAML_SP_CERT_FILE'), os.getenv('SAML_SP_KEY_FILE')
    if bool(cert_path) != bool(key_path):
        raise ValueError('Both SAML_SP_CERT_FILE and SAML_SP_KEY_FILE must be configured')
    if cert_path:
        sp.update(x509cert=Path(cert_path).read_text(), privateKey=Path(key_path).read_text())
    return {**idp, 'strict': True, 'debug': False, 'sp': sp, 'security': {
        'authnRequestsSigned': bool(cert_path), 'wantAssertionsSigned': True,
        'wantMessagesSigned': False, 'wantAttributeStatement': True,
        'rejectUnsolicitedResponsesWithInResponseTo': True, 'requestedAuthnContext': False,
        'signatureAlgorithm': 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
        'digestAlgorithm': 'http://www.w3.org/2001/04/xmlenc#sha256',
        'rejectDeprecatedAlgorithm': True,
    }}


def toolkit(post_data=None):
    from onelogin.saml2.auth import OneLogin_Saml2_Auth
    acs = urlsplit(os.environ['SAML_ACS_URL'])
    return OneLogin_Saml2_Auth({
        'https': 'on' if acs.scheme == 'https' else 'off', 'http_host': acs.netloc,
        'server_port': str(acs.port or (443 if acs.scheme == 'https' else 80)),
        'script_name': acs.path, 'get_data': {}, 'post_data': post_data or {},
    }, old_settings=settings())


def account(claims):
    """Never bind an existing local account by a matching email or display name."""
    issuer, subject = claims['issuer'], claims['subject']
    identity_key = hashlib.sha256(json.dumps([issuer, subject], ensure_ascii=False).encode()).hexdigest()
    identity = SsoIdentity.query.filter_by(identity_key=identity_key).first()
    if not identity:
        user = User(username='sso_' + identity_key, password_hash='!sso-only')
        user.set_role(ROLE_USER)
        identity = SsoIdentity(identity_key=identity_key, issuer=issuer, subject=subject, user=user)
        db.session.add(identity)
        try:
            db.session.flush()
        except IntegrityError:
            db.session.rollback()
            identity = SsoIdentity.query.filter_by(identity_key=identity_key).first()
            if not identity:
                raise
    if not identity.user.is_active:
        raise ValueError('Account has been deactivated. Contact an administrator.')
    identity.email = claims['email']
    identity.display_name = claims.get('name', '')
    identity.office = claims.get('office', '')
    identity.user.last_login = utc_now()
    db.session.commit()
    return identity.user
