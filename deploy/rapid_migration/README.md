# RAPID Environment Migration Tools

This directory contains automated Python utilities to build, package, export, and import RAPID deployment bundles for `fdalabel-v3`.

## Overview

The RAPID migration suite simplifies air-gapped or target server deployments by packaging Docker images and mounted configuration files into zip/tar archives.

Generated archives:
- Individual Docker image archives:
  - `image_backend.tar`: `fdalabel-v3-backend:latest`
  - `image_frontend.tar`: `fdalabel-v3-frontend:latest`
  - `image_nginx.tar`: `fdalabel-v3-nginx:latest`
  - `image_db.tar`: `fdalabel-v3-db:latest`
  - `image_redis.tar`: `fdalabel-v3-redis:latest`
- `rapid_files.zip`: Configuration scripts (`start_server.py`, `.env`, `.env.template.txt`), Nginx configurations, webtest folders, and public assets.
- `data.zip`: (Optional) Contents of the `data/` directory.

---

## 1. Exporting a Migration Package (`export_rapid_package.py`)

Run this script on the source machine to build Docker images and generate migration archives.

### Default Usage (Without `data.zip`)
```bash
python deploy/rapid_migration/export_rapid_package.py
```

### Exporting with Data Directory (`data.zip`)
```bash
python deploy/rapid_migration/export_rapid_package.py --include-data
```

### Options:
- `--include-data`: Also package `data/` folder into `data.zip` (default: `False`).
- `--skip-build`: Skip running `docker build` and use existing local images.
- `--output-dir OUTPUT_DIR`: Specify custom destination folder for generated archives (default: `deploy/rapid_migration`).

---

## 2. Importing a Migration Package (`import_rapid_package.py`)

Run this script on the destination RAPID server to load Docker images and extract files.

> **Note**: `import_rapid_package.py` **automatically overwrites** existing files and directories when extracting `rapid_files.zip` and `data.zip`.

### Default Usage (Extracts Images and Overwrites Config Files)
```bash
python deploy/rapid_migration/import_rapid_package.py
```

### Importing with Data Extraction (Overwrites `data/` directory)
```bash
python deploy/rapid_migration/import_rapid_package.py --include-data
```

### Options:
- `--include-data`: Unzip `data.zip` to overwrite `./data/` folder (default: `False`).
- `--source-dir SOURCE_DIR`: Source directory containing `image_*.tar`, `rapid_files.zip`, and optional `data.zip` (default: `deploy/rapid_migration`).
- `--target-dir TARGET_DIR`: Project root directory to extract files into (default: repo root).
- `--skip-images`: Skip loading Docker images (`docker load`).

---

## 3. Manual Unzip Instructions (Overwriting Files)

If you prefer to extract zip archives manually instead of using `import_rapid_package.py`, make sure to use the **overwrite** flag (`-o` on Linux / `-Force` on Windows):

### Linux / macOS (Use `-o` to overwrite existing files without prompting):
```bash
# Overwrite project configuration and mounted files
unzip -o deploy/rapid_migration/rapid_files.zip -d .

# Overwrite data folder (if data.zip exists)
unzip -o deploy/rapid_migration/data.zip -d .
```

### Windows PowerShell (Use `-Force` to overwrite existing files):
```powershell
# Overwrite project configuration and mounted files
Expand-Archive -Path deploy\rapid_migration\rapid_files.zip -DestinationPath . -Force

# Overwrite data folder (if data.zip exists)
Expand-Archive -Path deploy\rapid_migration\data.zip -DestinationPath . -Force
```

---

## 4. Launching RAPID Server

After importing the migration package, launch the stack using `start_server.py`:

```bash
python start_server.py --rapid
```
