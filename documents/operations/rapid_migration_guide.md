# RAPID Migration System Guide

## 1. Overview

The **RAPID Migration System** (`deploy/rapid_migration/`) enables fast deployment, cloning, and disaster recovery of AskFDALabel environments.

It packages production Docker images, mount scripts, and configuration files into portable zip archives on a source machine, allowing rapid unpack, restore, and startup on a target machine without requiring access to external git or container registries.

---

## 2. Exporting a Migration Package (`export_rapid_package.py`)

Run on the **source machine** (where the app is built and running):

```bash
# Basic export (exports backend, frontend, and redis images + rapid_files.zip)
python deploy/rapid_migration/export_rapid_package.py

# Include full persistent data directory (data.zip)
python deploy/rapid_migration/export_rapid_package.py --include-data

# Export all images (including Nginx and DB containers)
python deploy/rapid_migration/export_rapid_package.py --all-images
```

### Artifacts Generated:
- `image_backend.tar.gz`: Compressed backend Docker image.
- `image_frontend.tar.gz`: Compressed frontend Docker image.
- `image_redis.tar.gz`: Compressed Redis Docker image.
- `rapid_files.zip`: Project orchestrator (`start_server.py`), templates, mount scripts, and database initialization utilities.
- `data.zip` (Optional): Authoritative `data/` directory (temporary download files, caches, and `spl_cache` are automatically excluded).

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

# 2. Configure target environment credentials
cp .env.rapid.template .env
# Edit .env to set your PG_HOST, PG_USERNAME, PG_PASSWORD, etc.

# 3. Restore database dump (if target is a fresh database)
python deploy/rapid_migration/restore_db.py

# 4. Launch server in RAPID mode
python start_server.py --rapid
```

### Safety Features of `import_rapid_package.py`:
- **Protected Environment**: Never overwrites an existing target `.env` file during zip extraction.
- **Automated Schema Healing**: On startup in RAPID mode, backend `ensure_user_schema()` automatically adapts existing databases (e.g. converting legacy `citext` columns to `varchar(100)`).
