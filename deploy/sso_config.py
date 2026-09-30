"""Shared Docker/Apptainer SAML configuration and isolated test IdP profiles."""
import hashlib
import json
import secrets
from pathlib import Path
from urllib.parse import urlsplit
from deploy.nginx_config import resolve_nginx_tls

KEYCLOAK_IMAGE = 'quay.io/keycloak/keycloak:26.7.4'
KEYCLOAK_REALM_REVISION = 1
AUTH_PATH = '/api/dashboard/auth/saml'


def resolve_sso(env, mode, rapid=False, nginx=False, runtime='docker'):
    registered_acs = env.get('FDA_SAML_ACS_URL', '')
    origin = env.get('SSO_PUBLIC_ORIGIN', '').rstrip('/')
    if rapid and registered_acs:
        parsed_acs = urlsplit(registered_acs)
        origin = f'{parsed_acs.scheme}://{parsed_acs.netloc}'
    # Docker prod is also used on HPC. Use its configured public address rather
    # than publishing localhost in the realm issuer, ACS and completion URLs.
    if not origin and not rapid and runtime == 'docker' and mode == 'prod':
        host = env.get('API_SERVER_HOST') or env.get('NEXT_PUBLIC_API_SERVER_HOST')
        widget = urlsplit(env.get('NEXT_PUBLIC_WIDGET_HOST', ''))
        if widget.scheme in ('http', 'https') and widget.netloc and (not host or widget.hostname == host):
            origin = f'{widget.scheme}://{widget.netloc}'
    if not origin:
        use_public_host = runtime == 'apptainer' or mode == 'prod'
        host = (env.get('API_SERVER_HOST') or env.get('NEXT_PUBLIC_API_SERVER_HOST') or 'localhost') if use_public_host else 'localhost'
        port = ':8443' if runtime == 'apptainer' else ''
        cert, _ = resolve_nginx_tls(Path(__file__).resolve().parents[1], env, rapid) if nginx else (None, None)
        tls = cert is not None
        origin = f'{"https" if tls else "http"}://{host}{port if tls else (":8080" if runtime == "apptainer" else "")}' if nginx else f'http://{host}:8841'
    app_base = (env.get('NEXT_PUBLIC_APP_BASE') or env.get('NEXT_PUBLIC_DASHBOARD_BASE') or '/fdalabel-v3').rstrip('/')
    api_base = env.get('NEXT_PUBLIC_API_BASE', '/fdalabel-v3_api').rstrip('/')
    provider = 'fda' if rapid else 'keycloak'
    entity = env.get('FDA_SAML_ENTITY_ID', '') if rapid else (env.get('KEYCLOAK_SP_ENTITY_ID') or origin + api_base + AUTH_PATH + '/metadata')
    acs = registered_acs if rapid else origin + api_base + AUTH_PATH + '/acs'
    # FDA can have a registered ACS path different from our default route.
    acs_path = (env.get('FDA_SAML_ACS_PATH') or AUTH_PATH + '/acs') if rapid else AUTH_PATH + '/acs'
    config = {
        'SSO_PROVIDER': provider,
        'SSO_PUBLIC_ORIGIN': origin,
        'SSO_APP_BASE': app_base,
        'SSO_API_BASE': api_base,
        'SAML_SP_ENTITY_ID': entity,
        'SAML_ACS_URL': acs,
        'SAML_ACS_PATH': acs_path,
        'SAML_REDIS_URL': 'redis://redis:6379/0' if runtime == 'docker' else env.get('CELERY_BROKER_URL', 'redis://127.0.0.1:6379/0'),
        'SESSION_COOKIE_SECURE': 'true' if origin.startswith('https:') else 'false',
    }
    if rapid:
        config['SAML_IDP_METADATA_FILE'] = '/deploy/SSO_config/sso2.xml'
    else:
        public = env.get('KEYCLOAK_PUBLIC_URL', '').rstrip('/') or (origin + '/sso' if nginx else 'http://' + urlsplit(origin).hostname + ':8843')
        relative = urlsplit(public).path.rstrip('/') or '/'
        internal = f'http://keycloak:8080{relative.rstrip("/")}' if runtime == 'docker' else f'http://127.0.0.1:8843{relative.rstrip("/")}'
        config.update({
            'KEYCLOAK_PUBLIC_URL': public,
            'KEYCLOAK_RELATIVE_PATH': relative,
            'KEYCLOAK_TEST_USERNAME': env.get('KEYCLOAK_TEST_USERNAME') or 'leihong',
            'KEYCLOAK_TEST_PASSWORD': env.get('KEYCLOAK_TEST_PASSWORD') or '1986414',
            'SAML_IDP_METADATA_URL': internal + '/realms/askfdalabel/protocol/saml/descriptor',
            'SAML_IDP_ENTITY_ID': public + '/realms/askfdalabel',
        })
        if nginx and relative != '/sso':
            raise ValueError('With the bundled nginx, KEYCLOAK_PUBLIC_URL must use /sso')
        if urlsplit(public).scheme not in ('http', 'https') or not urlsplit(public).netloc:
            raise ValueError('KEYCLOAK_PUBLIC_URL must be an absolute HTTP(S) URL')
    for name in ('SSO_PUBLIC_ORIGIN', 'SAML_ACS_URL'):
        value = config[name]
        if value:
            parsed = urlsplit(value)
            if parsed.scheme not in ('http', 'https') or not parsed.netloc or parsed.username or parsed.query or parsed.fragment:
                raise ValueError(f'{name} must be an absolute HTTP(S) URL without credentials, query or fragment')
    if urlsplit(origin).path:
        raise ValueError('SSO_PUBLIC_ORIGIN must contain only scheme, host and optional port')
    if rapid:
        if registered_acs and not origin.startswith('https://'):
            raise ValueError('FDA SSO requires an HTTPS SSO_PUBLIC_ORIGIN')
        if acs and not acs.startswith('https://'):
            raise ValueError('FDA_SAML_ACS_URL must use HTTPS')
    return config


def prepare_keycloak(root, config):
    """One persistent realm per URL configuration; import never silently goes stale."""
    # Keycloak skips imports into an existing realm. Version the profile when
    # the realm template changes so restarting actually applies those changes.
    profile_data = {'config': config, 'realm_revision': KEYCLOAK_REALM_REVISION}
    profile = hashlib.sha256(json.dumps(profile_data, sort_keys=True).encode()).hexdigest()[:12]
    folder = Path(root) / 'data' / 'keycloak' / profile
    (folder / 'import').mkdir(parents=True, exist_ok=True)
    (folder / 'import').chmod(0o755)
    (folder / 'db').mkdir(exist_ok=True)
    folder.chmod(0o700)
    credentials_file = folder / 'credentials.json'
    if not credentials_file.exists():
        credentials_file.write_text(json.dumps({
            'admin_username': 'sso-admin', 'admin_password': secrets.token_urlsafe(24),
            'test_username': config['KEYCLOAK_TEST_USERNAME'],
            'test_password': config['KEYCLOAK_TEST_PASSWORD'],
        }, indent=2), encoding='utf-8')
        credentials_file.chmod(0o600)
    credentials = json.loads(credentials_file.read_text(encoding='utf-8'))
    realm = {
        'realm': 'askfdalabel', 'enabled': True, 'sslRequired': 'none' if config['KEYCLOAK_PUBLIC_URL'].startswith('http:') else 'external',
        'registrationAllowed': False, 'resetPasswordAllowed': False,
        'clients': [{
            'clientId': config['SAML_SP_ENTITY_ID'], 'name': 'askFDALabel test SAML',
            'enabled': True, 'protocol': 'saml',
            'redirectUris': [config['SAML_ACS_URL']],
            'attributes': {
                'saml_assertion_consumer_url_post': config['SAML_ACS_URL'],
                'saml.force.post.binding': 'true', 'saml.server.signature': 'true',
                'saml.assertion.signature': 'true', 'saml.client.signature': 'false',
                'saml.authnstatement': 'true',
                'saml.signature.algorithm': 'RSA_SHA256', 'saml_name_id_format': 'username',
                'saml_force_name_id_format': 'true',
            },
            'protocolMappers': [
                {'name': 'Email', 'protocol': 'saml', 'protocolMapper': 'saml-user-property-mapper',
                 'config': {'user.attribute': 'email', 'attribute.name': 'Email', 'attribute.nameformat': 'Basic'}},
                {'name': 'Name', 'protocol': 'saml', 'protocolMapper': 'saml-user-property-mapper',
                 'config': {'user.attribute': 'firstName', 'attribute.name': 'Name', 'attribute.nameformat': 'Basic'}},
                {'name': 'Office Info', 'protocol': 'saml', 'protocolMapper': 'saml-user-attribute-mapper',
                 'config': {'user.attribute': 'office', 'attribute.name': 'Office Info', 'attribute.nameformat': 'Basic'}},
            ],
        }],
        'users': [{
            'username': credentials['test_username'], 'enabled': True, 'emailVerified': True,
            'email': 'sso-test@example.test', 'firstName': 'SSO Test User', 'lastName': 'Development',
            'attributes': {'office': ['Development']},
            'credentials': [{'type': 'password', 'value': credentials['test_password'], 'temporary': False}],
        }],
    }
    realm_file = folder / 'import' / 'askfdalabel-realm.json'
    realm_file.write_text(json.dumps(realm, indent=2), encoding='utf-8')
    # Docker's Keycloak uid must read the import. The host profile directory is
    # private (0700), while the mounted import directory can be read in-container.
    realm_file.chmod(0o644)
    return folder, credentials
