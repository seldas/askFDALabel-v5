# RAPID Environment Migration Tools

This directory contains automated Python utilities to build, package, export, and import RAPID deployment bundles for `fdalabel-v3`.

## Overview

The RAPID migration suite simplifies air-gapped or target server deployments by packaging Docker images and mounted configuration files into zip/tar archives.

Generated archives:
- Individual compressed Docker image archives (`.tar.gz`):
  - `image_backend.tar.gz`: `fdalabel-v3-backend:latest`
  - `image_frontend.tar.gz`: `fdalabel-v3-frontend:latest`
  - `image_redis.tar.gz`: `fdalabel-v3-redis:latest`
  - `image_nginx.tar.gz`: `fdalabel-v3-nginx:latest` (Optional, with `--all-images`)
  - `image_db.tar.gz`: `fdalabel-v3-db:latest` (Optional, with `--all-images`)
- `rapid_files.zip`: Configuration scripts (`start_server.py`, `.env.template`, `.env.rapid.template`, `restore_db.py`, `dump_db.py`), Nginx configurations, webtest folders, and public assets (note: `.env` is deliberately excluded to protect target environment configuration).
- `data.zip`: (Optional) Contents of the `data/` directory.

---

> **Important**: The `.env` file is **not** included in the migration package and will **not** be overwritten during import. Since configuration parameters (remote PostgreSQL database host/port, Oracle 10.* proxy, Elsa AI credentials, local vLLM endpoint) vary across environments, configure the target server's `.env` independently using `.env.rapid.template`.

---

## 1. Exporting a Migration Package (`export_rapid_package.py`)

Run this script on the source machine to build Docker images and generate migration archives.

### Default RAPID Usage (Exports backend, frontend, redis + config files)
```bash
python deploy/rapid_migration/export_rapid_package.py
```

### Exporting with Data Directory (`data.zip`)
```bash
python deploy/rapid_migration/export_rapid_package.py --include-data
```

### Options:
- `--include-data`: Also package `data/` folder into `data.zip` (default: `False`).
- `--all-images`: Export all 5 images (including Nginx and local DB container).
- `--skip-build`: Skip running `docker build` and use existing local images.
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

```bash
python deploy/rapid_migration/import_rapid_package.py
```

---

## 4. RAPID Quickstart & Server Launch

1. **Configure Environment Variables**:
   ```bash
   cp .env.rapid.template .env
   # Edit .env to set PG_HOST, Elsa credentials, vLLM endpoint, and Oracle proxy credentials
   ```

2. **Restore Database (for fresh remote databases)**:
   ```bash
   python deploy/rapid_migration/restore_db.py
   ```

3. **Launch Server in RAPID Mode**:
   ```bash
   python start_server.py --rapid
   ```
   *In `--rapid` mode, the orchestrator connects to the remote PostgreSQL DB, disables internal Nginx container (allowing external Nginx on the host to proxy requests), and publishes frontend (`8841:8841`) and backend (`8842:8842`) ports.*
