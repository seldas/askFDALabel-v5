---
name: update_db
description: Automatically check publicly accessible databases (DailyMed monthly updates, FDA Orange Book, FDA EPC Pharmacologic Class Indexing), download updates into data/downloads, and execute database import scripts to update the database.
---

# update_db Skill

Use this skill when the user or AI agent needs to check, download, and import the latest public FDA data files and DailyMed label updates into the local `data/downloads/` directory and PostgreSQL database.

## Supported Public Data Sources

1. **FDA Orange Book (`products.txt`)**
   - **Source**: FDA official Orange Book zip download (`https://www.fda.gov/media/76860/download`).
   - **Target**: `data/downloads/OrangeBook/EOB_Latest/products.txt`.
   - **Database Import**: `python backend/database/scripts/db_04_import_orange_book.py` (updates `public.orange_book` table and reference listed drug / reference standard flags).

2. **FDA Pharmacologic Class Indexing (EPC)**
   - **Source**: DailyMed SPL Pharmacologic Class Indexing ZIP files (`https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json?category=indexing`).
   - **Target**: `data/downloads/pharmacologic_class_indexing_spl_files/`.
   - **Database Import**: `python backend/database/scripts/db_05_import_epc_indexing.py` (updates `labeling.substance_indexing`, `labeling.epc_map`, and `labeling.sum_spl.epc` column).

3. **DailyMed Monthly & SPL Drug Label Updates**
   - **Source**: NLM DailyMed SPL Drug Labels (`https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json`).
   - **Target**: `data/downloads/dailymed/` -> unpacked to `data/spl_storage/`.
   - **Database Import**: `python backend/database/scripts/db_07_import_labels.py --force --skip-unpack` (updates `labeling.sum_spl` and `labeling.spl_sections` with version-aware SPL parsing and recalculates `is_latest` markers).

---

## Workflow Instructions

### Option 1: Python Automated Check & Update Script

Run the automated script located inside the skill directory:

```bash
# Check all public sources for updates and run imports if changes are detected
python deploy/data_transfer/update_db/check_and_update_db.py

# Force re-download and re-import all sources
python deploy/data_transfer/update_db/check_and_update_db.py --force

# Target a specific data source ('orange', 'epc', or 'dailymed')
python deploy/data_transfer/update_db/check_and_update_db.py --source orange
```

### Option 2: Docker Container Execution

If the dev server container stack (`fdalabel-v3-backend`) is running, database import commands can also be executed directly inside the container:

```bash
# Orange Book import
docker exec -e PYTHONPATH=. fdalabel-v3-backend python database/scripts/db_04_import_orange_book.py

# EPC Pharmacologic Class Indexing import
docker exec -e PYTHONPATH=. fdalabel-v3-backend python database/scripts/db_05_import_epc_indexing.py

# Label import and sync
docker exec -e PYTHONPATH=. fdalabel-v3-backend python database/scripts/db_07_import_labels.py --force --skip-unpack
```

---

## Verification & Status Checks

After running an update, verify database record counts:

```bash
# Check total label count and latest version count in PostgreSQL
docker exec -e PYTHONPATH=. fdalabel-v3-backend python -c "from app import create_unified_app; app = create_unified_app(); app.app_context().push(); from dashboard.services.fdalabel_db import FDALabelDBService; conn = FDALabelDBService.get_postgres_connection(); cur = conn.cursor(); cur.execute('SELECT count(*), count(*) FILTER (WHERE is_latest) FROM labeling.sum_spl'); print('Labels (Total, Latest):', cur.fetchone())"

# Check Orange Book record count
docker exec -e PYTHONPATH=. fdalabel-v3-backend python -c "from app import create_unified_app; app = create_unified_app(); app.app_context().push(); from database.models import OrangeBook; print('Orange Book count:', OrangeBook.query.count())"
```
