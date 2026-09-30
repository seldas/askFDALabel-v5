# RAPID Migration System Guide

## 1. Overview

The **RAPID Migration System** (`deploy/rapid_migration/`) enables fast deployment, cloning, and disaster recovery of AskFDALabel environments.

It packages production Docker images, mount scripts, and configuration files into portable zip archives on a source machine, allowing rapid unpack, restore, and startup on a target machine without requiring access to external git or container registries.

---

## 2. Exporting a Migration Package (`export_rapid_package.py`)

Run on the **source machine** (where the app is built and running):

```bash
# Basic export (exports backend, frontend, redis and nginx + rapid_files.zip)
python deploy/rapid_migration/export_rapid_package.py

# Include full persistent data directory (data.zip)
python deploy/rapid_migration/export_rapid_package.py --include-data

# Export all images (also includes the local DB container)
python deploy/rapid_migration/export_rapid_package.py --all-images
```

### Artifacts Generated:
- `image_backend.tar.gz`: Compressed backend Docker image.
- `image_frontend.tar.gz`: Compressed frontend Docker image.
- `image_redis.tar.gz`: Compressed Redis Docker image.
- `image_nginx.tar.gz`: Compressed nginx Docker image (included by default).
- `rapid_files.zip`: Project orchestrator (`start_server.py`), templates, mount scripts, and database initialization utilities. Includes `deploy/sso_config.py`, `deploy/nginx_config.py`, FDA IdP metadata (`deploy/SSO_config/sso2.xml`), the external nginx ACS snippet (`deploy/SSO_config/rapid_saml_acs.conf`), and migration/SSO documentation.
- `data.zip` (Optional): Application `data/` directory (temporary download files, caches, `spl_cache`, and local/HPC test Keycloak profiles are excluded).

Rebuild backend, frontend and nginx images when exporting an SSO update (the default).
Use `--skip-build` only if the local images already contain the current SAML
dependencies, authentication routes, SSO login page, and updated nginx entrypoint. RAPID uses FDA SSO and
does not need a Keycloak image or test accounts. Export fails if required SSO
runtime files are missing; diagnostic logs and optional SP private keys are not
included in the SSO file list.

---

## 3. Database Dump & Restore

To snapshot and transfer the PostgreSQL database alongside container images:

### Step A: Dump Database (Source Machine)
```bash
python deploy/rapid_migration/dump_db.py
```
Dumps the database from the running `fdalabel-v3-db` container into `deploy/rapid_migration/fdalabel_db.dump` (custom compressed `-Fc` format).

### Step B: Restore Database (Target Machine)
```bash
python deploy/rapid_migration/restore_db.py --clean
```
Reads credentials from `.env` on the target machine and restores `fdalabel_db.dump` via `pg_restore` into the local Docker DB or remote PostgreSQL host.

---

## 4. Importing and Launching on Target Machine (`import_rapid_package.py`)

Transfer the exported archives to `deploy/rapid_migration/` on the target machine, then run:

```bash
# 1. Import images and extract configuration
python deploy/rapid_migration/import_rapid_package.py

# 2. For a NEW deployment only, create the environment file
cp .env.rapid.template .env
# Edit .env to set your PG_HOST, PG_USERNAME, PG_PASSWORD, etc.
# For an existing deployment, keep .env and merge missing SAML settings instead.

# 3. Restore database dump (if target is a fresh database)
python deploy/rapid_migration/restore_db.py

# 4. Configure nginx TLS certificates or upstream TLS termination (see below)

# 5. Launch server in RAPID mode
python start_server.py --rapid
```

### Safety Features of `import_rapid_package.py`:
- **Protected Environment**: Never overwrites an existing target `.env` file during zip extraction.
- **SSO Setup Notices**: Reports missing SSO runtime files or blank/missing FDA registration settings in the preserved `.env`, and reminds you to configure TLS. It does not change environment values. The startup orchestrator generates the nginx routes.
- **Automated Schema Healing**: On startup in RAPID mode, backend `ensure_user_schema()` automatically adapts existing databases (e.g. converting legacy `citext` columns to `varchar(100)`).

### FDA SSO setup on the target

Merge these registered values from `.env.rapid.template` into the target `.env`:

```dotenv
FDA_SAML_ENTITY_ID=https://askfdalabel-nctr.preprod.fda.gov
FDA_SAML_ACS_URL=https://askfdalabel-nctr.preprod.fda.gov/api/auth/saml
FDA_SAML_ACS_PATH=/api/auth/saml
```

Keep the Entity ID and ACS URL exactly as registered. RAPID derives its public
origin from `FDA_SAML_ACS_URL`, and reads the packaged metadata through the
`./deploy:/deploy` backend mount. If SP signing/encryption is required, provision
the configured `SAML_SP_CERT_FILE` and `SAML_SP_KEY_FILE` separately at paths
accessible inside the backend container.

RAPID starts the bundled nginx by default and generates an exact ACS location
from `FDA_SAML_ACS_URL`, forwarding the POST directly to `FDA_SAML_ACS_PATH`.
Login and completion use the normal API routes. No Keycloak route is generated.
TLS files are provisioned separately on each target and mounted read-only. The
nginx image and migration archive omit nginx certificates/private keys; RAPID
never falls back to a local/HPC certificate.
Configure `RAPID_NGINX_CERT_FILE` and `RAPID_NGINX_KEY_FILE` with RAPID host
paths (default `deploy/nginx/certs/rapid/cert.pem` and `key.pem`), or terminate TLS upstream
and preserve Host and `X-Forwarded-Proto: https`. Docker publishes nginx 80/443;
rootless Apptainer uses 8080/8443. Non-rapid prod retains its Keycloak `/sso/` route.

If an external proxy must handle all routes instead, start with `--no-nginx`.
Only in that setup, apply `deploy/SSO_config/rapid_saml_acs.conf` to the external
nginx (adjust for a different registered path), validate and reload it. Keep the
normal app/API proxy routes too. Existing packages without the nginx image must
be re-exported or have the rebuilt nginx image transferred before normal rapid startup.

For a new target database, restore the full database dump to preserve users and
their SSO identity associations. The updated backend creates the SSO identity
table on startup for existing databases. After startup, test a fresh SSO login
from the pre-prod URL. See `documents/operations/saml_sso.md` for troubleshooting.
