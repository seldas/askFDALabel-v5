import os
import sys
import argparse
import glob
import re
import zipfile
import multiprocessing
from datetime import datetime, timezone
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
try:
    import defusedxml.ElementTree as ET
except ImportError:
    import xml.etree.ElementTree as ET
from sqlalchemy import text

# Add backend to path
backend_dir = Path(__file__).resolve().parent.parent.parent
sys.path.append(str(backend_dir))

from database import db, SystemTask, DrugLabel, ActiveIngredientMap
from dashboard import create_app

NS = {'ns': 'urn:hl7-org:v3'}

def update_progress(task_id, progress, message=None, status='processing'):
    if not task_id: return
    try:
        task = db.session.get(SystemTask, task_id)
        if task:
            if task.status == 'cancelled':
                import sys
                sys.exit(0)
                
            task.progress = progress
            if message: task.message = message
            task.status = status
            task.updated_at = datetime.now(timezone.utc)
            if status == 'completed': task.completed_at = datetime.now(timezone.utc)
            db.session.commit()
    except Exception as e:
        print(f"Error updating progress: {e}")

def get_el_text(el):
    return "".join(el.itertext()).strip() if el is not None else ""

def parse_spl_file(file_path, ob_dict, is_archived=False):
    """Worker function to parse a single SPL file (ZIP or XML)."""
    try:
        if is_archived:
            with open(file_path, 'r', encoding='utf-8') as f:
                xml_content = f.read()
        else:
            with zipfile.ZipFile(file_path, 'r') as z:
                xml_files = [f for f in z.namelist() if f.endswith('.xml')]
                if not xml_files: return None
                with z.open(xml_files[0]) as f:
                    xml_content = f.read()
        
        root = ET.fromstring(xml_content)
        spl_id = root.find('ns:id', NS).get('root') if root.find('ns:id', NS) is not None else None
        set_id = root.find('ns:setId', NS).get('root') if root.find('ns:setId', NS) is not None else None
        if not spl_id or not set_id: return None

        eff_val_el = root.find('ns:effectiveTime', NS)
        eff_val = eff_val_el.get('value') if eff_val_el is not None else ""
        if len(eff_val) >= 8 and eff_val[:8].isdigit():
            revised_date = f"{eff_val[:4]}-{eff_val[4:6]}-{eff_val[6:8]}"
        else:
            revised_date = eff_val
        effective_time_raw = eff_val

        doc_type_el = root.find('ns:code', NS)
        doc_type = doc_type_el.get('displayName') if doc_type_el is not None else ""

        title_el = root.find('ns:title', NS)
        title_text = get_el_text(title_el)
        appr_match = re.search(r'Initial U\.S\. Approval:\s*(\d{4})', title_text)
        initial_approval_year = int(appr_match.group(1)) if appr_match else None

        # Manufacturer
        manufacturer = ""
        author_org = root.find('.//ns:author/ns:assignedEntity/ns:representedOrganization/ns:name', NS)
        if author_org is not None and author_org.text: manufacturer = author_org.text.strip()

        product_names, generic_names, active_ingredients, dosage_forms, ndc_codes, routes, appr_nums = [], [], [], [], [], [], []
        ingr_map = []
        
        products = root.findall('.//ns:manufacturedProduct/ns:manufacturedProduct', NS)
        for prod in products:
            if (name_el := prod.find('ns:name', NS)) is not None: product_names.append(get_el_text(name_el))
            if (gen_name_el := prod.find('.//ns:genericMedicine/ns:name', NS)) is not None: generic_names.append(get_el_text(gen_name_el))
            if (form_el := prod.find('ns:formCode', NS)) is not None: dosage_forms.append(form_el.get('displayName'))
            if (ndc_el := prod.find('ns:code', NS)) is not None: ndc_codes.append(ndc_el.get('code'))
            for ingr in prod.findall('ns:ingredient', NS):
                class_code = ingr.get('classCode')
                subst_el = ingr.find('ns:ingredientSubstance', NS)
                if subst_el is not None:
                    name_el = subst_el.find('ns:name', NS)
                    code_el = subst_el.find('ns:code', NS)
                    if name_el is not None:
                        sub_name = get_el_text(name_el)
                        unii = code_el.get('code') if (code_el is not None and code_el.get('codeSystem') == '2.16.840.1.113883.4.9') else ""
                        # ACTIR is active too — it differs from ACTIB/ACTIM only
                        # in what the strength is expressed against.
                        is_active = 1 if class_code in ('ACTIM', 'ACTIB', 'ACTIR') else 0
                        if is_active: active_ingredients.append(sub_name)
                        ingr_map.append({'spl_id': spl_id, 'substance_name': sub_name, 'unii': unii, 'is_active': is_active})
            for rel in prod.findall('.//ns:routeCode', NS): routes.append(rel.get('displayName'))

        if (appr_el := root.find('.//ns:approval/ns:id', NS)) is not None: appr_nums.append(appr_el.get('extension'))

        # RLD/RS logic
        is_rld, is_rs = 0, 0
        if appr_nums:
            spl_df_normalized = [df.upper().replace(',', '') for df in dosage_forms if df]
            spl_rt_normalized = [rt.upper().replace(',', '') for rt in routes if rt]
            
            for raw_appr in appr_nums:
                # Regex captures the text prefix (NDA/ANDA) and the digits separately
                match = re.search(r'(NDA|ANDA|N|A)\s*(\d+)', raw_appr.upper())
                if match:
                    prefix, num_part = match.groups()
                    # Normalize prefix
                    normalized_prefix = 'NDA' if prefix in ['NDA', 'N'] else 'ANDA' if prefix in ['ANDA', 'A'] else prefix
                    # Normalize application number to 6 padded digits
                    normalized_no = num_part.zfill(6)
                    
                    target_key = f"{normalized_prefix}{normalized_no}"
                    
                    if target_key in ob_dict:
                        for prod in ob_dict[target_key]:
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

        # Section bodies are not stored: labeling.spl_sections was dropped with
        # full-text search, and the viewer reads SPL XML from disk.

        all_appr = "; ".join(set(appr_nums))

        return {
            'metadata': {
                'spl_id': spl_id, 'set_id': set_id, 'product_names': "; ".join(set(product_names)), 
                'generic_names': "; ".join(set(generic_names)), 'manufacturer': manufacturer,
                'appr_num': all_appr, 'active_ingredients': "; ".join(set(active_ingredients)),
                'doc_type': doc_type, 'routes': "; ".join(set(routes)), 
                'dosage_forms': "; ".join(set(filter(None, dosage_forms))), 'ndc_codes': "; ".join(set(filter(None, ndc_codes))),
                'revised_date': revised_date, 'effective_time_raw': effective_time_raw,
                'initial_approval_year': initial_approval_year, 'is_rld': is_rld, 'is_rs': is_rs,
                'local_path': os.path.basename(file_path)
            },
            'ingr_map': ingr_map,
            'spl_id': spl_id,
            'set_id': set_id,
            'revised_date': revised_date
        }
    except Exception:
        return None

def load_orange_book(app):
    ob_dict = {}
    ob_path = Path(app.config['DATA_DIR']) / 'downloads' / 'OrangeBook' / 'EOB_Latest' / 'products.txt'
    if ob_path.exists():
        try:
            with open(ob_path, 'r', encoding='latin-1') as f:
                f.readline()
                for line in f:
                    parts = line.split('~')
                    if len(parts) > 11:
                        # Normalize type: 'N' -> 'NDA', 'A' -> 'ANDA'
                        raw_type = parts[5].strip().upper()
                        appl_type = 'NDA' if raw_type == 'N' else 'ANDA' if raw_type == 'A' else raw_type
                        
                        # Pad the application number to 6 digits to match standard FDA formats
                        appl_no = parts[6].strip().zfill(6)
                        
                        compound_key = f"{appl_type}{appl_no}" # e.g., "NDA205613"
                        
                        df_route = parts[1].upper() # e.g. AEROSOL, FOAM;RECTAL
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
        except Exception as e: 
            print(f"Error loading Orange Book: {e}")
    return ob_dict

def import_labels():
    parser = argparse.ArgumentParser(description='Import SPL Label Data')
    parser.add_argument('--force', action='store_true')
    parser.add_argument('--task-id', type=int)
    parser.add_argument('--skip-unpack', action='store_true')
    parser.add_argument('--workers', type=int, default=multiprocessing.cpu_count())
    parser.add_argument('--archived', action='store_true')
    args = parser.parse_args()

    app = create_app()
    with app.app_context():
        task_id = args.task_id
        try:
            print("=== Drug Label Data Importer (Task-Enabled) ===")
            update_progress(task_id, 5, "Initializing label import...")
            
            # Initialize schema using authoritative script
            scripts_dir = backend_dir / 'database' / 'scripts'
            if str(scripts_dir) not in sys.path:
                sys.path.append(str(scripts_dir))
            
            import db_02_init_labeling_schema as labeling_init
            labeling_init.init_labeling_schema()
            
            db.create_all()

            if not args.skip_unpack and not args.archived:
                print("  [+] Unpacking bulk ZIPs from downloads/DailyMed...")
                update_progress(task_id, 7, "Unpacking bulk DailyMed ZIPs...")
                
                downloads_dir = Path(app.config['DATA_DIR']) / 'downloads' / 'DailyMed'
                storage_dir = Path(app.config['DATA_DIR']) / 'spl_storage'
                storage_dir.mkdir(parents=True, exist_ok=True)
                
                bulk_zips = glob.glob(str(downloads_dir / "*.zip"))
                if bulk_zips:
                    processed = set()
                    try:
                        res = db.session.execute(text("SELECT zip_name FROM labeling.processed_zips")).fetchall()
                        processed = {r[0] for r in res}
                    except Exception as e:
                        print(f"Error querying processed_zips: {e}")

                    prefixes = ['prescription/', 'otc/', 'homeopathic/', 'other/']
                    for idx, zip_path in enumerate(bulk_zips):
                        zip_name = os.path.basename(zip_path)
                        if zip_name in processed:
                            print(f"Skipping already processed bulk ZIP: {zip_name}")
                            continue

                        print(f"Unpacking bulk ZIP ({idx+1}/{len(bulk_zips)}): {zip_name}...")
                        update_progress(task_id, 7, f"Unpacking bulk ZIP ({idx+1}/{len(bulk_zips)}): {zip_name}...")
                        
                        try:
                            with zipfile.ZipFile(zip_path, 'r') as main_z:
                                all_members = main_z.namelist()
                                nested_zips = [
                                    f for f in all_members
                                    if f.endswith('.zip') and any(f.startswith(p) for p in prefixes)
                                ]

                                for nz_name in nested_zips:
                                    inner_name = os.path.basename(nz_name)
                                    out_path = storage_dir / inner_name
                                    if not out_path.exists():
                                        with main_z.open(nz_name) as source, open(out_path, 'wb') as target:
                                            target.write(source.read())

                            db.session.execute(
                                text("INSERT INTO labeling.processed_zips (zip_name) VALUES (:zip_name) ON CONFLICT DO NOTHING"),
                                {"zip_name": zip_name}
                            )
                            db.session.commit()
                        except Exception as e:
                            print(f"Error unpacking {zip_name}: {e}")
                else:
                    print(f"No bulk ZIP files found in {downloads_dir}")
                    update_progress(task_id, 7, "No bulk DailyMed ZIPs found to unpack. Proceeding with existing spl_storage...")

            if args.force:
                print("  [-] Force update: Clearing labeling tables...")
                update_progress(task_id, 10, "Clearing existing data...")
                db.session.execute(text("TRUNCATE TABLE labeling.sum_spl CASCADE"))
                db.session.commit()

            if args.archived:
                storage_dir = Path(app.config['DATA_DIR']) / 'spl_storage_archived'
                target_files = glob.glob(str(storage_dir / "*.xml"))
            else:
                storage_dir = Path(app.config['DATA_DIR']) / 'spl_storage'
                target_files = glob.glob(str(storage_dir / "*.zip"))
                
            if not target_files:
                raise FileNotFoundError(f"No files found in {storage_dir}")

            print(f"  [+] Found {len(target_files)} files to process.")
            ob_dict = load_orange_book(app)
            
            # Get existing to avoid duplicates if not forcing
            existing = set()
            existing_spls = set()
            if not args.force:
                res = db.session.execute(text("SELECT set_id, revised_date, spl_id FROM labeling.sum_spl")).fetchall()
                existing = {(r[0], r[1]) for r in res}
                existing_spls = {r[2] for r in res}

            batch_size = 200
            meta_batch, ingr_batch, spl_id_batch = [], [], []
            processed, skipped = 0, 0
            total_files = len(target_files)

            update_progress(task_id, 15, f"Parsing {total_files} files...")

            with ProcessPoolExecutor(max_workers=args.workers) as executor:
                futures = [executor.submit(parse_spl_file, f, ob_dict, args.archived) for f in target_files]
                
                for i, future in enumerate(as_completed(futures)):
                    data = future.result()
                    if not data: continue
                    
                    if (data['set_id'], data['revised_date']) in existing or data['spl_id'] in existing_spls:
                        skipped += 1
                        continue
                    
                    meta_batch.append(data['metadata'])
                    ingr_batch.extend(data['ingr_map'])
                    spl_id_batch.append(data['spl_id'])
                    processed += 1
                    
                    if len(meta_batch) >= batch_size or (i + 1) == total_files:
                        # Clean up existing SPL IDs in this batch to handle updates
                        if spl_id_batch:
                            db.session.execute(
                                text("DELETE FROM labeling.sum_spl WHERE spl_id = ANY(:ids)"),
                                {"ids": spl_id_batch}
                            )
                        
                        if meta_batch:
                            db.session.bulk_insert_mappings(DrugLabel, meta_batch)
                        if ingr_batch:
                            db.session.bulk_insert_mappings(ActiveIngredientMap, ingr_batch)
                        
                        db.session.commit()
                        meta_batch, ingr_batch, spl_id_batch = [], [], []
                        
                    current_idx = i + 1
                    if current_idx % 100 == 0 or current_idx == total_files:
                        prog = 15 + int(80 * (current_idx / total_files))
                        update_progress(task_id, prog, f"Processed {current_idx}/{total_files} files...")

            update_progress(task_id, 95, "Refreshing version lineage...")
            try:
                db.session.execute(text("""
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
                """))
                db.session.commit()
                print("  [+] Version lineage metadata updated.")
            except Exception as e:
                print(f"  [!] Warning: Could not refresh version lineage: {e}")
                db.session.rollback()

            update_progress(task_id, 100, f"Import complete. Processed: {processed}, Skipped: {skipped}", status='completed')
            print(f"\n[!] Success! Processed: {processed}, Skipped: {skipped}")

            # Final step: Populate EPC column from substance_indexing if available
            print("  [+] Updating EPC mappings from indexing table...")
            try:
                db.session.execute(text("""
                    INSERT INTO labeling.epc_map (spl_id, epc_term)
                    SELECT DISTINCT m.spl_id, i.indexing_name
                    FROM labeling.active_ingredients_map m
                    JOIN labeling.substance_indexing i ON (
                        (m.unii != '' AND m.unii = i.substance_unii) OR 
                        (m.unii = '' AND UPPER(m.substance_name) = UPPER(i.substance_name))
                    )
                    WHERE i.indexing_type = 'EPC' AND m.is_active = 1
                    ON CONFLICT DO NOTHING;

                    WITH agg_epc AS (
                        SELECT spl_id, string_agg(DISTINCT epc_term, '; ') as epcs
                        FROM labeling.epc_map
                        GROUP BY spl_id
                    )
                    UPDATE labeling.sum_spl s
                    SET epc = a.epcs
                    FROM agg_epc a
                    WHERE s.spl_id = a.spl_id AND (s.epc IS NULL OR s.epc = '');
                """))
                db.session.commit()
                print("  [+] EPC mappings updated.")
            except Exception as e:
                print(f"  [!] Warning: Could not update EPC mappings: {e}")
                db.session.rollback()

        except Exception as e:
            print(f"  [!] Error: {e}")
            if task_id:
                try:
                    task = db.session.get(SystemTask, task_id)
                    if task:
                        task.status = 'failed'
                        task.error_details = str(e)
                        db.session.commit()
                except: pass

if __name__ == "__main__":
    import_labels()
