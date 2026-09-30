# RAPID Environment Migration Tools

This directory contains automated Python utilities to build, package, export, and import RAPID deployment bundles for `fdalabel-v3`.

## Overview

The RAPID migration suite simplifies air-gapped or target server deployments by packaging Docker images and mounted configuration files into zip/tar archives.

Generated archives:
- Individual compressed Docker image archives (`.tar.gz`):
  - `image_backend.tar.gz`: `fdalabel-v3-backend:latest`
  - `image_frontend.tar.gz`: `fdalabel-v3-frontend:latest`
  - `image_redis.tar.gz`: `fdalabel-v3-redis:latest`
  - `image_nginx.tar.gz`: `fdalabel-v3-nginx:latest` (included by default)
- `rapid_files.zip`: Configuration scripts (`start_server.py`, `deploy/sso_config.py`, `deploy/nginx_config.py`, `.env.template`, `.env.rapid.template`, `restore_db.py`, `dump_db.py`), FDA SSO metadata (`deploy/SSO_config/sso2.xml`), external nginx ACS snippet (`deploy/SSO_config/rapid_saml_acs.conf`), migration/SSO documentation, database scripts, Nginx configurations, webtest folders, and public assets. `.env` is deliberately excluded to protect target environment configuration.
- `data.zip`: (Optional) Contents of the `data/` directory, excluding temporary caches and local/HPC Keycloak test profiles.

---

> **Important**: The `.env` file is **not** included in the migration package and will **not** be overwritten during import. Since configuration parameters (remote PostgreSQL database host/port, Oracle 10.* proxy, Elsa AI credentials, local vLLM endpoint) vary across environments, configure the target server's `.env` independently using `.env.rapid.template`.

---

## 1. Exporting a Migration Package (`export_rapid_package.py`)

Run this script on the source machine to build Docker images and generate migration archives.

### Default RAPID Usage (Exports backend, frontend, redis, nginx + config files)
```bash
python deploy/rapid_migration/export_rapid_package.py
```

### Exporting with Data Directory (`data.zip`)
```bash
python deploy/rapid_migration/export_rapid_package.py --include-data
```

### Options:
- `--include-data`: Also package `data/` folder into `data.zip` (default: `False`).
- `--all-images`: Export all 5 images (also includes the local DB container).
- `--skip-build`: Skip running `docker build` and use existing local images. For an SSO update, rebuild first: existing images must contain the current SAML dependencies, authentication routes, SSO home page, and updated nginx entrypoint.
- `--output-dir OUTPUT_DIR`: Specify custom destination folder for generated archives (default: `deploy/rapid_migration`).

---

## 2. Exporting Database Dump (`dump_db.py`)

To dump the PostgreSQL database from a running local database container:
```bash
python deploy/rapid_migration/dump_db.py
```
This writes `deploy/rapid_migration/fdalabel_db.dump`.

---

## 3. Importing a Migration Package (`import_rapid_package.py`)

Run this script on the destination RAPID server to load Docker images and extract files.

> **Note**: `import_rapid_package.py` extracts files and directories from `rapid_files.zip` and `data.zip` while protecting any existing `.env` from being overwritten.

The importer reports missing SSO files and FDA registration settings, and reminds
you to configure nginx TLS or an upstream TLS proxy. It does not edit `.env`.
RAPID uses FDA SSO and requires no Keycloak container or test users.

```bash
python deploy/rapid_migration/import_rapid_package.py
```

---

## 4. RAPID Quickstart & Server Launch

1. **Configure Environment Variables**:
   ```bash
   # New deployment only; preserve an existing .env
   cp .env.rapid.template .env
   # Edit .env to set PG_HOST, Elsa credentials, vLLM endpoint, and Oracle proxy credentials
   ```

   For an existing deployment, merge the SAML section from `.env.rapid.template`
   into `.env`, including `FDA_SAML_ENTITY_ID`, `FDA_SAML_ACS_URL` and
   `FDA_SAML_ACS_PATH`. Keep the registered values exact. Provision optional SP
   signing/encryption certificate and private key files separately if required.

2. **Restore Database (for fresh remote databases)**:
   ```bash
   python deploy/rapid_migration/restore_db.py
   ```

3. **Configure Nginx TLS**:
   Set `RAPID_NGINX_CERT_FILE` and `RAPID_NGINX_KEY_FILE` to RAPID host paths
   (defaults: `deploy/nginx/certs/rapid/cert.pem` and `key.pem`), or forward traffic from an
   upstream HTTPS proxy with Host and `X-Forwarded-Proto: https` preserved.
   Provision RAPID TLS files separately: nginx images and migration archives
   exclude nginx certificates/private keys. RAPID never uses the local/HPC pair.
   Startup generates the registered ACS route automatically. If using
   `--no-nginx`, configure all routes on your external nginx instead; the
   `deploy/SSO_config/rapid_saml_acs.conf` snippet covers the default ACS route.

4. **Launch Server in RAPID Mode**:
   ```bash
   python start_server.py --rapid
   ```
   *In `--rapid` mode, the orchestrator connects to the remote PostgreSQL DB and starts internal nginx on 80/443. App/API services stay behind nginx. Its generated ACS route uses the registered external URL and backend ACS path from `.env`; Keycloak is omitted. `--no-nginx` restores direct 8841/8842 publishing for an external proxy.*
