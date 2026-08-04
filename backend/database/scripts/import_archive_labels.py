import os
import glob
import re
import argparse
import sys
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor, as_completed
import xml.etree.ElementTree as ET

# Dynamic path resolution to support both host execution and container environments
current_dir = Path(__file__).resolve().parent
repo_root = current_dir
for parent in [current_dir] + list(current_dir.parents):
    if (parent / '.env').exists() or (parent / '.env.template.txt').exists():
        repo_root = parent
        break

# Add backend directory to sys.path
if (repo_root / 'backend').exists():
    sys.path.append(str(repo_root / 'backend'))
else:
    sys.path.append(str(repo_root))

from pg_utils import PGUtils
from psycopg2 import sql
from psycopg2.extras import execute_values

NS = {'ns': 'urn:hl7-org:v3'}

_ob_dict = {}


def get_el_text(el):
    return "".join(el.itertext()).strip() if el is not None else ""


def _init_worker(ob_dict):
    global _ob_dict
    _ob_dict = ob_dict


def normalize_effective_date(eff_val):
    eff_val = (eff_val or "").strip()
    if len(eff_val) >= 8 and eff_val[:8].isdigit():
        return f"{eff_val[:4]}-{eff_val[4:6]}-{eff_val[6:8]}", eff_val
    return None, eff_val


def parse_spl_xml(xml_path):
    """
    Worker function to parse one SPL XML file.
    """
    try:
        tree = ET.parse(xml_path)
        root = tree.getroot()

        spl_id_el = root.find('ns:id', NS)
        spl_id = spl_id_el.get('root') if spl_id_el is not None else None

        set_id_el = root.find('ns:setId', NS)
        set_id = set_id_el.get('root') if set_id_el is not None else None

        if not spl_id or not set_id:
            return None

        eff_val_el = root.find('ns:effectiveTime', NS)
        eff_val = eff_val_el.get('value') if eff_val_el is not None else ""
        revised_date, effective_time_raw = normalize_effective_date(eff_val)

        doc_type_el = root.find('ns:code', NS)
        doc_type = doc_type_el.get('displayName') if doc_type_el is not None else ""

        title_el = root.find('ns:title', NS)
        title_text = get_el_text(title_el)
        appr_match = re.search(r'Initial U\.S\. Approval:\s*(\d{4})', title_text)
        initial_approval_year = int(appr_match.group(1)) if appr_match else None

        author_path = 'ns:author/ns:assignedEntity/ns:representedOrganization/ns:name'
        author_org = root.find(author_path, NS)
        manufacturer = author_org.text.strip() if (author_org is not None and author_org.text) else ""

        product_names = []
        generic_names = []
        active_ingredients = []
        dosage_forms = []
        ndc_codes = []
        routes = []
        appr_nums = []
        ingr_map = []

        products = root.findall('.//ns:manufacturedProduct/ns:manufacturedProduct', NS)

        for prod in products:
            name_el = prod.find('ns:name', NS)
            if name_el is not None:
                product_names.append(get_el_text(name_el))

            gen_name_el = prod.find('.//ns:genericMedicine/ns:name', NS)
            if gen_name_el is not None:
                generic_names.append(get_el_text(gen_name_el))

            form_el = prod.find('ns:formCode', NS)
            if form_el is not None:
                dosage_forms.append(form_el.get('displayName') or "")

            ndc_el = prod.find('ns:code', NS)
            if ndc_el is not None:
                ndc_codes.append(ndc_el.get('code') or "")

            for ingr in prod.findall('ns:ingredient', NS):
                class_code = ingr.get('classCode')
                subst_el = ingr.find('ns:ingredientSubstance', NS)
                if subst_el is None:
                    continue

                name_el = subst_el.find('ns:name', NS)
                code_el = subst_el.find('ns:code', NS)

                if name_el is None:
                    continue

                sub_name = get_el_text(name_el)
                unii = ""

                if code_el is not None and code_el.get('codeSystem') == '2.16.840.1.113883.4.9':
                    unii = code_el.get('code') or ""

                # ACTIR is active too — it differs from ACTIB/ACTIM only in what
                # the strength is expressed against (reference substance).
                is_active = 1 if class_code in ('ACTIM', 'ACTIB', 'ACTIR') else 0

                if is_active:
                    active_ingredients.append(sub_name)

                ingr_map.append((spl_id, sub_name, unii, is_active))

            for rel in prod.findall('.//ns:routeCode', NS):
                routes.append(rel.get('displayName') or "")

        appr_el = root.find('.//ns:approval/ns:id', NS)
        if appr_el is not None:
            appr_nums.append(appr_el.get('extension') or "")

        is_rld, is_rs = 0, 0
        all_appr = "; ".join(sorted(set(filter(None, appr_nums))))

        if appr_nums:
            spl_df_normalized = [df.upper().replace(',', '') for df in dosage_forms if df]
            spl_rt_normalized = [rt.upper().replace(',', '') for rt in routes if rt]
            
            for raw_appr in appr_nums:
                match = re.search(r'(NDA|ANDA|N|A)\s*(\d+)', raw_appr.upper())
                if match:
                    prefix, num_part = match.groups()
                    normalized_prefix = 'NDA' if prefix in ['NDA', 'N'] else 'ANDA' if prefix in ['ANDA', 'A'] else prefix
                    normalized_no = num_part.zfill(6)
                    target_key = f"{normalized_prefix}{normalized_no}"
                    
                    if target_key in _ob_dict:
                        for prod in _ob_dict[target_key]:
                            ob_df_tokens = set(prod['dosage_form'].replace(',', '').split())
                            ob_rt_tokens = set(prod['route'].replace(',', '').split())
                            
                            df_match = False
                            if not ob_df_tokens:
                                df_match = True
                            else:
                                for s_df in spl_df_normalized:
                                    if ob_df_tokens.intersection(set(s_df.split())):
                                        df_match = True
                                        break
                                        
                            rt_match = False
                            if not ob_rt_tokens:
                                rt_match = True
                            else:
                                for s_rt in spl_rt_normalized:
                                    if ob_rt_tokens.intersection(set(s_rt.split())):
                                        rt_match = True
                                        break
                                        
                            if df_match and rt_match:
                                if prod['is_rld']: is_rld = 1
                                if prod['is_rs']: is_rs = 1

        sections_db = []

        for sec in root.findall('.//ns:section', NS):
            sec_code_el = sec.find('ns:code', NS)
            loinc = sec_code_el.get('code') if sec_code_el is not None else ""

            sec_title_el = sec.find('ns:title', NS)
            title = get_el_text(sec_title_el)

            text_el = sec.find('ns:text', NS)
            if text_el is not None:
                raw_xml = ET.tostring(text_el, encoding='unicode').strip()
                sections_db.append((spl_id, loinc, title, raw_xml))

        metadata = (
            spl_id,
            set_id,
            "; ".join(sorted(set(filter(None, product_names)))),
            "; ".join(sorted(set(filter(None, generic_names)))),
            manufacturer,
            all_appr,
            "; ".join(sorted(set(filter(None, active_ingredients)))),
            "",
            doc_type,
            "; ".join(sorted(set(filter(None, routes)))),
            "; ".join(sorted(set(filter(None, dosage_forms)))),
            "",
            "; ".join(sorted(set(filter(None, ndc_codes)))),
            revised_date,
            effective_time_raw,
            initial_approval_year,
            is_rld,
            is_rs,
            os.path.basename(xml_path)
        )

        return {
            'spl_id': spl_id,
            'set_id': set_id,
            'revised_date': revised_date,
            'metadata': metadata,
            'ingr_map': ingr_map,
            'sections': sections_db
        }

    except Exception:
        return None


def load_orange_book():
    ob_dict = {}
    ob_path = repo_root / 'data' / 'downloads' / 'OrangeBook' / 'EOB_Latest' / 'products.txt'

    if ob_path.exists():
        try:
            with open(ob_path, 'r', encoding='latin-1') as f:
                f.readline()
                for line in f:
                    parts = line.split('~')
                    if len(parts) > 11:
                        raw_type = parts[5].strip().upper()
                        appl_type = 'NDA' if raw_type == 'N' else 'ANDA' if raw_type == 'A' else raw_type
                        
                        appl_no = parts[6].strip().zfill(6)
                        compound_key = f"{appl_type}{appl_no}"
                        
                        df_route = parts[1].upper()
                        df_route_parts = df_route.split(';')
                        dosage_form = df_route_parts[0].strip() if len(df_route_parts) > 0 else ""
                        route = df_route_parts[1].strip() if len(df_route_parts) > 1 else ""
                        
                        is_rld = 1 if parts[10].strip().upper() == 'YES' else 0
                        is_rs = 1 if parts[11].strip().upper() == 'YES' else 0
                        
                        if compound_key not in ob_dict:
                            ob_dict[compound_key] = []
                            
                        ob_dict[compound_key].append({
                            'dosage_form': dosage_form,
                            'route': route,
                            'is_rld': is_rld,
                            'is_rs': is_rs
                        })

            print(f"Loaded {len(ob_dict)} records from Orange Book.")

        except Exception as e:
            print(f"Warning: Failed to parse Orange Book: {e}")
    else:
        print(f"Warning: Orange Book not found at {ob_path}")

    return ob_dict


def ensure_schema():
    try:
        PGUtils.execute_query("SELECT 1 FROM labeling.sum_spl LIMIT 1")
    except Exception:
        import db_02_init_labeling_schema as labeling_init
        labeling_init.init_labeling_schema()


def refresh_version_lineage():
    print("Refreshing version lineage metadata...")
    conn = PGUtils.get_connection()

    try:
        with conn.cursor() as cur:
            cur.execute("""
                WITH ranked AS (
                    SELECT
                        spl_id,
                        set_id,
                        revised_date,
                        imported_at,
                        ROW_NUMBER() OVER (
                            PARTITION BY set_id
                            ORDER BY revised_date ASC NULLS LAST,
                                     imported_at ASC,
                                     spl_id ASC
                        ) AS version_number,
                        LAG(spl_id) OVER (
                            PARTITION BY set_id
                            ORDER BY revised_date ASC NULLS LAST,
                                     imported_at ASC,
                                     spl_id ASC
                        ) AS parent_spl_id,
                        CASE
                            WHEN ROW_NUMBER() OVER (
                                PARTITION BY set_id
                                ORDER BY revised_date DESC NULLS LAST,
                                         imported_at DESC,
                                         spl_id DESC
                            ) = 1
                            THEN TRUE ELSE FALSE
                        END AS is_latest
                    FROM labeling.sum_spl
                )
                UPDATE labeling.sum_spl s
                SET version_number = r.version_number,
                    parent_spl_id = r.parent_spl_id,
                    is_latest = r.is_latest
                FROM ranked r
                WHERE s.spl_id = r.spl_id
            """)

        conn.commit()
        print("Version lineage metadata updated.")

    except Exception as e:
        conn.rollback()
        print(f"Warning: Could not refresh version lineage: {e}")

    finally:
        conn.close()


def refresh_epc_mappings():
    print("Updating EPC mappings from indexing table...")

    try:
        PGUtils.execute_query("""
            INSERT INTO labeling.epc_map (spl_id, epc_term)
            SELECT DISTINCT m.spl_id, i.indexing_name
            FROM labeling.active_ingredients_map m
            JOIN labeling.substance_indexing i
              ON (
                    (m.unii IS NOT NULL AND m.unii != '' AND m.unii = i.substance_unii)
                 OR ((m.unii IS NULL OR m.unii = '') AND UPPER(m.substance_name) = UPPER(i.substance_name))
              )
            WHERE i.indexing_type = 'EPC'
              AND m.is_active = 1
            ON CONFLICT DO NOTHING
        """)

        PGUtils.execute_query("""
            WITH agg_epc AS (
                SELECT spl_id, string_agg(DISTINCT epc_term, '; ' ORDER BY epc_term) AS epcs
                FROM labeling.epc_map
                GROUP BY spl_id
            )
            UPDATE labeling.sum_spl s
            SET epc = a.epcs
            FROM agg_epc a
            WHERE s.spl_id = a.spl_id
              AND (s.epc IS NULL OR s.epc = '')
        """)

        print("EPC mappings updated.")

    except Exception as e:
        print(f"Warning: Could not update EPC mappings: {e}")


def _flush_batches(meta_batch, ingr_batch, sect_batch, reload_spl_ids):
    if not meta_batch:
        return

    conn = PGUtils.get_connection()

    try:
        with conn.cursor() as cur:
            cols = [
                'spl_id', 'set_id', 'product_names', 'generic_names', 'manufacturer',
                'appr_num', 'active_ingredients', 'market_categories', 'doc_type',
                'routes', 'dosage_forms', 'epc', 'ndc_codes', 'revised_date',
                'effective_time_raw', 'initial_approval_year', 'is_rld', 'is_rs',
                'local_path'
            ]

            insert_sql = sql.SQL("""
                INSERT INTO labeling.sum_spl ({cols})
                VALUES %s
                ON CONFLICT (spl_id) DO UPDATE SET
                    set_id = EXCLUDED.set_id,
                    product_names = EXCLUDED.product_names,
                    generic_names = EXCLUDED.generic_names,
                    manufacturer = EXCLUDED.manufacturer,
                    appr_num = EXCLUDED.appr_num,
                    active_ingredients = EXCLUDED.active_ingredients,
                    market_categories = EXCLUDED.market_categories,
                    doc_type = EXCLUDED.doc_type,
                    routes = EXCLUDED.routes,
                    dosage_forms = EXCLUDED.dosage_forms,
                    ndc_codes = EXCLUDED.ndc_codes,
                    revised_date = EXCLUDED.revised_date,
                    effective_time_raw = EXCLUDED.effective_time_raw,
                    initial_approval_year = EXCLUDED.initial_approval_year,
                    is_rld = EXCLUDED.is_rld,
                    is_rs = EXCLUDED.is_rs,
                    local_path = EXCLUDED.local_path,
                    imported_at = CURRENT_TIMESTAMP
            """).format(cols=sql.SQL(', ').join(map(sql.Identifier, cols)))

            execute_values(cur, insert_sql, meta_batch, page_size=500)

            if reload_spl_ids:
                cur.execute(
                    "DELETE FROM labeling.active_ingredients_map WHERE spl_id = ANY(%s)",
                    (reload_spl_ids,)
                )
                cur.execute(
                    "DELETE FROM labeling.spl_sections WHERE spl_id = ANY(%s)",
                    (reload_spl_ids,)
                )
                cur.execute(
                    "DELETE FROM labeling.epc_map WHERE spl_id = ANY(%s)",
                    (reload_spl_ids,)
                )

            if ingr_batch:
                execute_values(
                    cur,
                    """
                    INSERT INTO labeling.active_ingredients_map
                    (spl_id, substance_name, unii, is_active)
                    VALUES %s
                    """,
                    ingr_batch,
                    page_size=1000
                )

            if sect_batch:
                execute_values(
                    cur,
                    """
                    INSERT INTO labeling.spl_sections
                    (spl_id, loinc_code, title, content_xml)
                    VALUES %s
                    """,
                    sect_batch,
                    page_size=500
                )

        conn.commit()

    except Exception:
        conn.rollback()
        raise

    finally:
        conn.close()


def sync_from_storage(storage_dir, num_workers=4, force=False, refresh_existing=False):
    root_dir = repo_root
    storage_path = root_dir / storage_dir

    xml_files = sorted(glob.glob(str(storage_path / "*.xml")))

    if not xml_files:
        print(f"No XML files found in {storage_path}")
        return

    print(f"Found {len(xml_files)} XML files in {storage_path}")

    ob_dict = load_orange_book()
    ensure_schema()

    existing_spl_ids = set()

    if not force and not refresh_existing:
        try:
            results = PGUtils.execute_query("SELECT spl_id FROM labeling.sum_spl", fetch=True)
            existing_spl_ids = {r['spl_id'] for r in results}
            print(f"Loaded {len(existing_spl_ids)} existing SPL IDs from database.")
        except Exception as e:
            print(f"Warning: Could not load existing SPL IDs: {e}")
    else:
        print("Refresh mode enabled: existing SPLs will be reparsed and upserted.")

    batch_size = 300
    meta_batch = []
    ingr_batch = []
    sect_batch = []
    reload_spl_ids = []

    imported = 0
    skipped = 0
    failed = 0

    print(f"Starting XML parsing with {num_workers} workers...")

    with ProcessPoolExecutor(
        max_workers=num_workers,
        initializer=_init_worker,
        initargs=(ob_dict,)
    ) as executor:

        future_to_xml = {
            executor.submit(parse_spl_xml, xp): xp
            for xp in xml_files
        }

        total = len(future_to_xml)

        for i, future in enumerate(as_completed(future_to_xml), start=1):
            try:
                data = future.result()
            except Exception:
                failed += 1
                continue

            if not data:
                failed += 1
                continue

            spl_id = data['spl_id']

            if not force and not refresh_existing and spl_id in existing_spl_ids:
                skipped += 1
            else:
                meta_batch.append(data['metadata'])
                ingr_batch.extend(data['ingr_map'])
                sect_batch.extend(data['sections'])
                reload_spl_ids.append(spl_id)
                imported += 1

            if len(meta_batch) >= batch_size or i == total:
                if meta_batch:
                    try:
                        _flush_batches(
                            meta_batch,
                            ingr_batch,
                            sect_batch,
                            reload_spl_ids
                        )
                    except Exception as e:
                        print(f"\n[ERROR] Batch insertion failed: {e}")

                meta_batch = []
                ingr_batch = []
                sect_batch = []
                reload_spl_ids = []

            if i % 100 == 0 or i == total:
                sys.stdout.write(
                    f"\rProgress: {i}/{total} | "
                    f"Imported: {imported} | "
                    f"Skipped: {skipped} | "
                    f"Failed: {failed}"
                )
                sys.stdout.flush()

    print(
        f"\nFinished Sync. Imported: {imported}, "
        f"Skipped: {skipped}, Failed: {failed}"
    )

    refresh_version_lineage()
    refresh_epc_mappings()

    try:
        try:
            from db_07_import_labels import refresh_query_options_cache
            from db_02_init_labeling_schema import ensure_search_indexes
        except ImportError:
            from database.scripts.db_07_import_labels import refresh_query_options_cache
            from database.scripts.db_02_init_labeling_schema import ensure_search_indexes
        refresh_query_options_cache()
        ensure_search_indexes()
    except Exception as e:
        print(f"[WARN] Failed to refresh options cache or search indexes post-sync: {e}")


def main():
    parser = argparse.ArgumentParser(
        description="SPL XML to PostgreSQL Sync Pipeline."
    )

    parser.add_argument(
        "--storage-dir",
        default="data/spl_storage_archived",
        help="Folder containing SPL XML files"
    )

    parser.add_argument(
        "--workers",
        type=int,
        default=4,
        help="Number of worker processes"
    )

    parser.add_argument(
        "--force",
        action="store_true",
        help="Reparse and upsert all XML files"
    )

    parser.add_argument(
        "--refresh-existing",
        action="store_true",
        help="Reparse and upsert existing spl_id values too"
    )

    args = parser.parse_args()

    print("=== Syncing XML files to PostgreSQL ===")

    sync_from_storage(
        args.storage_dir,
        num_workers=args.workers,
        force=args.force,
        refresh_existing=args.refresh_existing
    )


if __name__ == "__main__":
    main()