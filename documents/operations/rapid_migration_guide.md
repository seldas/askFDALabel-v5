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
python deploy/rapid_migration/import_rapid_package.py --source-dir /transfer/release

# 2. For a NEW deployment only, create the environment file
cp .env.rapid.template .env
# Edit .env to set your PG_HOST, PG_USERNAME, PG_PASSWORD, etc.
# For an existing deployment, keep .env and merge missing SAML settings instead.

# 3. Restore database dump (if target is a fresh database)
python deploy/rapid_migration/restore_db.py

# 4. Configure nginx TLS certificates or upstream TLS termination (see below)

# 5. Launch server in RAPID mode
python start_server.py --runtime docker --rapid
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


## Validated releases (current workflow)

Export defaults to a new `deploy/rapid_migration/releases/<UTC release ID>/`
directory. An explicit `--output-dir` must be empty. Transfer the entire release
folder, including `manifest.json`, without mixing files from other releases.
The manifest records SHA256, size, image IDs, OS and architecture. A manifest is
written only after all artifacts have been produced successfully. These hashes
check integrity, not publisher authenticity; transfer packages through trusted channels.

```bash
python deploy/rapid_migration/export_rapid_package.py --all-images --include-data
# Substitute the actual exported release directory below.
python deploy/rapid_migration/import_rapid_package.py --source-dir /transfer/release --include-data --verify-only
python deploy/rapid_migration/import_rapid_package.py --source-dir /transfer/release --include-data
python deploy/rapid_migration/restore_db.py --input /transfer/fdalabel_db.dump
python start_server.py --runtime docker --rapid
```

On first deployment or when upgrading an older importer, copy the current
`import_rapid_package.py` **and** `package_utils.py` into the target
`deploy/rapid_migration/` directory before running them. A new importer requires
a manifest; old bundles must be re-exported. `--skip-images` still validates
all release artifacts. `--verify-only` performs no Docker calls or target writes.
Only image archives named in the manifest are loaded; unrelated archives are ignored.
Loaded image IDs are verified before project files are extracted.

The importer preflights required files, hashes, ZIP CRCs and extraction paths
before loading any image or overwriting any project file. It rejects path traversal
and ZIP symlinks, and streams extraction in bounded chunks. Existing `.env` and
`data/config/` are protected. Data export omits `data/config/`; configure the
target runtime settings separately. Data import merges files and does not remove
old files. Database dumps are separate artifacts and are not created by image export.
Pause writers when taking a database/data snapshot if cross-store consistency is required.

Backend images now include database scripts required by RAPID management tasks;
rebuild them once instead of using `--skip-build` for this upgrade. FDA SSO metadata
includes both `sso2.xml` and `sso3-metadata.xml`. TLS keys remain separately provisioned.

For offline database restore, either install compatible PostgreSQL client tools
or export `--all-images`. The fallback uses the loaded `fdalabel-v3-db:latest`
with `--pull=never`. The PostgreSQL client version must support the source dump
and target server. Restore prefers `DATABASE_URL` over individual `PG_*` fields.
SQL and custom-format restore failures stop with a nonzero exit status; restore
is not transactional and a failure may leave partially restored objects.
Client certificate paths must also be available inside a restore container.

Import does not restart running containers, perform a health check, or provide
transactional rollback. Use a maintenance window, retain the previous release
and database backup, then start the stack and verify its health. Failures during
Docker load or file writes can still leave a partially applied release.
