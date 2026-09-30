"""Generate mode-specific proxy routes for Docker and rootless Apptainer."""
import hashlib
import re
from pathlib import Path
from urllib.parse import urlsplit


def _path(value):
    if not re.fullmatch(r'/[A-Za-z0-9/_~.%-]*', value):
        raise ValueError('Invalid nginx route path: ' + value)
    return value


def resolve_nginx_tls(root, env, rapid):
    """RAPID never falls back to a local/HPC certificate."""
    prefix = 'RAPID_NGINX_' if rapid else 'NGINX_'
    cert_value = env.get(prefix + 'CERT_FILE', '').strip()
    key_value = env.get(prefix + 'KEY_FILE', '').strip()
    explicit = bool(cert_value or key_value)
    if explicit and not (cert_value and key_value):
        raise ValueError(f'Set both {prefix}CERT_FILE and {prefix}KEY_FILE')
    defaults = 'deploy/nginx/certs/rapid' if rapid else 'deploy/nginx'
    cert = Path(cert_value or defaults + '/cert.pem')
    key = Path(key_value or defaults + '/key.pem')
    cert = cert if cert.is_absolute() else Path(root) / cert
    key = key if key.is_absolute() else Path(root) / key
    if cert.is_file() and key.is_file():
        return cert.resolve(), key.resolve()
    if explicit or cert.exists() or key.exists():
        raise ValueError(f'NGINX TLS certificate/key pair is missing or incomplete for {"rapid" if rapid else "local/HPC"}')
    return None, None


def generate_nginx_config(root, config, rapid, runtime='docker', env=None):
    source = Path(root) / 'deploy' / 'nginx'
    cert, key = resolve_nginx_tls(root, env or {}, rapid)
    tls = cert is not None
    app_base = _path(config['SSO_APP_BASE'])
    api_base = _path(config['SSO_API_BASE'])
    backend = 'http://backend:8842' if runtime == 'docker' else 'http://127.0.0.1:8842'
    acs = ''
    if rapid and config['SAML_ACS_URL']:
        external_path = _path(urlsplit(config['SAML_ACS_URL']).path)
        backend_path = _path(config['SAML_ACS_PATH'])
        acs = f'''    # Registered FDA ACS: proxy the POST directly; never redirect it.
    location = {external_path} {{
        proxy_pass {backend}{backend_path};
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header X-Forwarded-Host $http_host;
        proxy_set_header X-Forwarded-Proto $sso_proxy_proto;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Prefix "";
        proxy_set_header Connection "";
        client_max_body_size 2m;
        proxy_connect_timeout 10s;
        proxy_read_timeout 60s;
    }}
'''
    rendered = {}
    for filename, target in [('default.conf', 'default.conf'), ('ssl.conf.template', 'ssl.conf')]:
        content = (source / filename).read_text(encoding='utf-8')
        content = content.replace('/fdalabel-v3_api', '@API_BASE@').replace('/fdalabel-v3', '@APP_BASE@')
        content = content.replace('@API_BASE@', api_base).replace('@APP_BASE@', app_base)
        # Escape literal path characters in the rewrite's regular expression.
        content = content.replace('rewrite ^' + api_base + '/', 'rewrite ^' + re.escape(api_base) + '/')
        content = content.replace('    # FDA_ACS_ROUTE', acs.rstrip())
        if rapid:
            content = re.sub(r'    # Test SAML IdP.*?    # End test SAML IdP\n', '', content, flags=re.S)
        # Preserve the configured public port when redirecting (e.g. HPC :8443).
        origin = config['SSO_PUBLIC_ORIGIN']
        if tls and origin.startswith('https://'):
            content = content.replace('https://$http_host$request_uri', origin + '$request_uri')
        if not tls:
            content = content.replace('default 1;', 'default 0;').replace('"~^http:.*$" 1;', '"~^http:.*$" 0;')
            if filename == 'ssl.conf.template':
                content = '# SSL disabled: no certificate configured\n'
        if runtime == 'apptainer':
            content = content.replace('http://backend:', 'http://127.0.0.1:')
            content = content.replace('http://frontend:', 'http://127.0.0.1:')
            content = content.replace('http://keycloak:8080', 'http://127.0.0.1:8843')
            content = content.replace('listen 80;', 'listen 8080;').replace('listen 443 ssl;', 'listen 8443 ssl;')
        rendered[target] = content
    # A changed mount path makes Compose recreate nginx when routes/TLS change.
    digest = hashlib.sha256(''.join(rendered.values()).encode())
    if tls:
        digest.update(cert.read_bytes())
        digest.update(key.read_bytes())
    output = Path(root) / 'data' / ('nginx-' + runtime + '-' + digest.hexdigest()[:12])
    output.mkdir(parents=True, exist_ok=True)
    # Hide any certificates baked into older images, including HTTP-only runs.
    (output / 'certs').mkdir(exist_ok=True)
    for target, content in rendered.items():
        (output / target).write_text(content, encoding='utf-8')
    return output
