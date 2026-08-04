#!/usr/bin/env python3
"""
db_09_update_columns.py

High-performance fast column updater for PostgreSQL `labeling.sum_spl` and `labeling.active_ingredients_map`.
Designed to update targeted metadata columns (e.g. application types / marketing categories, approval numbers,
UNII, active ingredients, document types) across 700,000+ SPL records without re-parsing or re-inserting
heavy section text / XML into `labeling.spl_sections`.

Scans XML and ZIP files from multiple storage directories (e.g., data/spl_storage, data/spl_storage_archived).

Usage:
  python backend/database/scripts/db_09_update_columns.py
  python backend/database/scripts/db_09_update_columns.py --storage-dirs data/spl_storage,data/spl_storage_archived --workers 12 --batch-size 20000
"""

import argparse
from concurrent.futures import ProcessPoolExecutor, as_completed
import os
from pathlib import Path
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

# ---------------------------------------------------------------------------
# Path setup for standalone or containerized execution
# ---------------------------------------------------------------------------
current_dir = Path(__file__).resolve().parent
for parent in [current_dir] + list(current_dir.parents):
    if (parent / 'backend').exists():
        sys.path.append(str(parent / 'backend'))
        break
    elif (parent / 'pg_utils.py').exists() or (parent / 'database' / 'scripts').exists():
        sys.path.append(str(parent))
        break

from pg_utils import PGUtils
from psycopg2.extras import execute_values

NS = {'ns': 'urn:hl7-org:v3'}
UNII_CODE_SYSTEM = '2.16.840.1.113883.4.9'
ACTIVE_INGREDIENT_CLASS_CODES = ('ACTIB', 'ACTIM', 'ACTIR')

MARKETING_CATEGORY_BY_CODE = {
    'C73584':  'ANDA',
    'C73594':  'NDA',
    'C73585':  'BLA',
    'C73605':  'NDA authorized generic',
    'C200263': 'OTC monograph drug',
    'C73621':  'OTC monograph final',
    'C73620':  'OTC monograph not final',
    'C73614':  'unapproved homeopathic',
    'C73627':  'unapproved drug other',
    'C73613':  'unapproved medical gas',
    'C101533': 'unapproved drug for use in drug shortage',
    'C73626':  'bulk ingredient',
    'C98252':  'bulk ingredient for animal drug compounding',
    'C86952':  'dietary supplement',
    'C86964':  'medical food',
    'C86965':  'cosmetic',
    'C73590':  'export only',
    'C80438':  'exempt device',
    'C96966':  'Emergency Use Authorization',
}

_CATEGORY_ACRONYMS = {'OTC', 'NDA', 'ANDA', 'BLA', 'EUA', 'NADA', 'ANADA', 'US'}
_APP_ID_RE = re.compile(r'^(ANADA|ANDA|NADA|NDA|BLA)\s*[-#]?\s*0*(\d[\d-]*)$', re.IGNORECASE)


def get_el_text(el):
    return "".join(el.itertext()).strip() if el is not None else ""


def extract_unii(substance_el):
    if substance_el is None:
        return ""
    for code_el in substance_el.findall('ns:code', NS):
        if code_el.get('codeSystem') == UNII_CODE_SYSTEM and code_el.get('code'):
            return code_el.get('code').strip()
    return ""


def normalize_market_category(code, display_name):
    code = (code or "").strip().upper()
    if code in MARKETING_CATEGORY_BY_CODE:
        return MARKETING_CATEGORY_BY_CODE[code]

    display = " ".join((display_name or "").split())
    if not display:
        return ""
    return " ".join(
        tok.upper() if tok.upper() in _CATEGORY_ACRONYMS else tok.lower()
        for tok in display.split()
    )


def extract_approvals(root, doc_title=""):
    appr_nums = []
    categories = []

    def add_appr(kind, number):
        number = number.zfill(6) if number.isdigit() else number
        normalized = f"{kind.upper()} {number}"
        if normalized not in appr_nums:
            appr_nums.append(normalized)

    for approval in root.findall('.//ns:subjectOf/ns:approval', NS):
        code_el = approval.find('ns:code', NS)
        if code_el is not None:
            category = normalize_market_category(
                code_el.get('code'), code_el.get('displayName')
            )
            if category and category not in categories:
                categories.append(category)

        id_el = approval.find('ns:id', NS)
        extension = (id_el.get('extension') or "").strip() if id_el is not None else ""
        if not extension:
            continue
        m = _APP_ID_RE.match(extension)
        if m:
            add_appr(m.group(1), m.group(2))

    if not appr_nums:
        m = re.search(r'(NDA|ANDA|BLA)\s*(\d{5,6})', doc_title, re.IGNORECASE)
        if not m:
            for text in root.itertext():
                m = re.search(r'(NDA|ANDA|BLA)\s*(\d{5,6})', text or "", re.IGNORECASE)
                if m:
                    break
        if m:
            add_appr(m.group(1), m.group(2))

    return appr_nums, "; ".join(sorted(categories, key=str.casefold))


def parse_file_metadata_only(file_path):
    """
    Lightweight worker function: extracts ONLY metadata attributes from XML/ZIP,
    bypassing section bodies and text parsing entirely.
    """
    file_str = str(file_path)
    try:
        if file_str.endswith('.zip'):
            with zipfile.ZipFile(file_str, 'r') as z:
                xml_files = [f for f in z.namelist() if f.endswith('.xml')]
                if not xml_files:
                    return None
                with z.open(xml_files[0]) as f:
                    root = ET.parse(f).getroot()
        elif file_str.endswith('.xml'):
            root = ET.parse(file_str).getroot()
        else:
            return None

        spl_id_el = root.find('ns:id', NS)
        spl_id = (spl_id_el.get('root') if spl_id_el is not None else "").strip().lower()
        if not spl_id:
            return None

        set_id_el = root.find('ns:setId', NS)
        set_id = (set_id_el.get('root') if set_id_el is not None else "").strip().lower()

        code_el = root.find('ns:code', NS)
        doc_type = code_el.get('displayName') if code_el is not None else ""

        title_el = root.find('ns:title', NS)
        doc_title = get_el_text(title_el) if title_el is not None else ""

        appr_nums, market_categories = extract_approvals(root, doc_title)
        appr_num_str = "; ".join(appr_nums)

        # Active ingredients & UNII mappings
        active_ingr = []
        ingr_map = []
        seen_ingr = set()

        for ingr in root.findall('.//ns:ingredient', NS):
            class_code = ingr.get('classCode') or ""
            is_active = class_code in ACTIVE_INGREDIENT_CLASS_CODES
            substance = ingr.find('ns:ingredientSubstance', NS)
            if substance is not None:
                name_el = substance.find('ns:name', NS)
                s_name = get_el_text(name_el)
                unii = extract_unii(substance)

                if s_name:
                    if is_active and s_name.upper() not in seen_ingr:
                        active_ingr.append(s_name)
                        seen_ingr.add(s_name.upper())

                    ingr_map.append({
                        'spl_id': spl_id,
                        'set_id': set_id,
                        'substance_name': s_name,
                        'unii': unii,
                        'is_active': is_active
                    })

        active_ingr_str = "; ".join(active_ingr)

        return {
            'spl_id': spl_id,
            'set_id': set_id,
            'doc_type': doc_type,
            'market_categories': market_categories,
            'appr_num': appr_num_str,
            'active_ingredients': active_ingr_str,
            'ingr_map': ingr_map
        }
    except Exception:
        return None


def execute_batch_update(meta_batch):
    if not meta_batch:
        return 0, 0

    conn = PGUtils.get_connection()
    updated_sum_spl = 0
    updated_ingr = 0

    try:
        conn.autocommit = False
        with conn.cursor() as cur:
            # 1. Temporary staging table for sum_spl updates
            cur.execute("""
                CREATE TEMP TABLE tmp_spl_update (
                    spl_id TEXT PRIMARY KEY,
                    doc_type TEXT,
                    market_categories TEXT,
                    appr_num TEXT,
                    active_ingredients TEXT
                ) ON COMMIT DROP;
            """)

            # Deduplicate by spl_id to handle multiple XML/ZIP files containing the same SPL UUID
            dedup_spl = {}
            for m in meta_batch:
                spl_id = m['spl_id']
                dedup_spl[spl_id] = (
                    spl_id,
                    m['doc_type'],
                    m['market_categories'],
                    m['appr_num'],
                    m['active_ingredients']
                )

            rows_to_insert = list(dedup_spl.values())

            execute_values(
                cur,
                """
                INSERT INTO tmp_spl_update (spl_id, doc_type, market_categories, appr_num, active_ingredients)
                VALUES %s
                ON CONFLICT (spl_id) DO UPDATE SET
                    doc_type = EXCLUDED.doc_type,
                    market_categories = EXCLUDED.market_categories,
                    appr_num = EXCLUDED.appr_num,
                    active_ingredients = EXCLUDED.active_ingredients;
                """,
                rows_to_insert,
                page_size=2000
            )

            # High-performance batch UPDATE ... FROM staging
            cur.execute("""
                UPDATE labeling.sum_spl s
                SET
                    doc_type = COALESCE(NULLIF(t.doc_type, ''), s.doc_type),
                    market_categories = COALESCE(NULLIF(t.market_categories, ''), s.market_categories),
                    appr_num = COALESCE(NULLIF(t.appr_num, ''), s.appr_num),
                    active_ingredients = COALESCE(NULLIF(t.active_ingredients, ''), s.active_ingredients)
                FROM tmp_spl_update t
                WHERE s.spl_id = t.spl_id;
            """)
            updated_sum_spl = cur.rowcount

            # 2. Update active ingredients map / UNII
            ingr_dedup = {}
            for m in meta_batch:
                for item in m.get('ingr_map', []):
                    key = (item['spl_id'], item['substance_name'].upper())
                    ingr_dedup[key] = (
                        item['spl_id'],
                        item['substance_name'],
                        item['unii'],
                        1 if item['is_active'] else 0
                    )

            ingr_rows = list(ingr_dedup.values())

            if ingr_rows:
                spl_ids = list(dedup_spl.keys())
                cur.execute("DELETE FROM labeling.active_ingredients_map WHERE spl_id = ANY(%s);", (spl_ids,))
                execute_values(
                    cur,
                    """
                    INSERT INTO labeling.active_ingredients_map (spl_id, substance_name, unii, is_active)
                    VALUES %s;
                    """,
                    ingr_rows,
                    page_size=2000
                )
                updated_ingr = len(ingr_rows)

        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"\n[ERROR] Batch update failed: {e}")
    finally:
        conn.close()

    return updated_sum_spl, updated_ingr


def run_fast_column_update(storage_dirs, workers=8, batch_size=20000):
    print("=== DB_09: Fast Column Update Pipeline ===")
    print(f"Target Storage Directories: {storage_dirs}")
    print(f"Parallel Workers: {workers} | Batch Size: {batch_size}")

    file_paths = []
    for s_dir in storage_dirs:
        p = Path(s_dir)
        if not p.exists():
            print(f"[WARN] Storage directory '{s_dir}' not found. Skipping...")
            continue
        zips = list(p.rglob("*.zip"))
        xmls = list(p.rglob("*.xml"))
        file_paths.extend(zips)
        file_paths.extend(xmls)

    total_files = len(file_paths)
    print(f"Found {total_files:,} total SPL files to inspect across storage folders.")
    if total_files == 0:
        print("No files found to process. Exiting.")
        return

    processed = 0
    updated_records = 0
    updated_ingr_total = 0
    meta_batch = []

    with ProcessPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(parse_file_metadata_only, f): f for f in file_paths}

        for future in as_completed(futures):
            processed += 1
            res = future.result()

            if res is not None:
                meta_batch.append(res)

            if len(meta_batch) >= batch_size or processed == total_files:
                u_sum, u_ingr = execute_batch_update(meta_batch)
                updated_records += u_sum
                updated_ingr_total += u_ingr
                meta_batch = []

            if processed % 1000 == 0 or processed == total_files:
                sys.stdout.write(
                    f"\rProgress: {processed:,}/{total_files:,} ({processed/total_files*100:.1f}%) | "
                    f"Updated sum_spl: {updated_records:,} | Updated active_ingr: {updated_ingr_total:,}"
                )
                sys.stdout.flush()

    print(f"\nFinished parsing & batch column update. Updated {updated_records:,} sum_spl records.")

    # Post-sync refresh routines
    print("\n--- Triggering Post-Sync System Refresh Hooks ---")
    try:
        try:
            from db_07_import_labels import refresh_version_lineage, refresh_epc_mappings, refresh_query_options_cache
            from db_02_init_labeling_schema import ensure_search_indexes
        except ImportError:
            from database.scripts.db_07_import_labels import refresh_version_lineage, refresh_epc_mappings, refresh_query_options_cache
            from database.scripts.db_02_init_labeling_schema import ensure_search_indexes

        refresh_version_lineage()
        refresh_epc_mappings()
        refresh_query_options_cache()
        ensure_search_indexes()
        print("All post-sync system refresh hooks completed successfully!")
    except Exception as e:
        print(f"[WARN] Error running post-sync refresh hooks: {e}")


def main():
    parser = argparse.ArgumentParser(
        description="DB_09 Fast Column Update Utility for PostgreSQL labeling schema."
    )
    parser.add_argument(
        "--storage-dirs",
        default="data/spl_storage,data/spl_storage_archived",
        help="Comma-separated paths to SPL storage directories"
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=8,
        help="Number of parallel worker processes (default: 8)"
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=20000,
        help="Number of records per DB transaction batch (default: 20000)"
    )

    args = parser.parse_args()
    dirs = [d.strip() for d in args.storage_dirs.split(",") if d.strip()]

    run_fast_column_update(
        storage_dirs=dirs,
        workers=args.workers,
        batch_size=args.batch_size
    )


if __name__ == "__main__":
    main()
