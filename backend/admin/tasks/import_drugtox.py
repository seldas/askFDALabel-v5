import os
import sys
import argparse
import pandas as pd
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path
from sqlalchemy import text
import re

# Add backend to path
backend_dir = Path(__file__).resolve().parent.parent.parent
sys.path.append(str(backend_dir))

from database import db, DrugToxicity, SystemTask, DrugLabel
from dashboard import create_app

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
            task.updated_at = datetime.now(ZoneInfo("America/Chicago")).replace(tzinfo=None)
            if status == 'completed': task.completed_at = datetime.now(ZoneInfo("America/Chicago")).replace(tzinfo=None)
            db.session.commit()
    except Exception as e:
        print(f"Error updating progress: {e}")

def import_drugtox():
    parser = argparse.ArgumentParser(description='Import DrugToxicity data')
    parser.add_argument('--force', action='store_true')
    parser.add_argument('--task-id', type=int)
    args = parser.parse_args()

    app = create_app()
    with app.app_context():
        task_id = args.task_id
        try:
            print(f"=== DrugTox Data Importer (Task-Enabled) ===")
            print(f"  [i] Started at: {datetime.now(ZoneInfo('America/Chicago')).replace(tzinfo=None)}")
            update_progress(task_id, 5, "Initializing DrugTox import...")
            
            table_name = DrugToxicity.__tablename__
            
            if args.force:
                print(f"  [-] Force update: Dropping {table_name} table...")
                db.session.execute(text(f"DROP TABLE IF EXISTS {table_name} CASCADE"))
                db.session.commit()
                db.create_all()

            data_dir = Path(app.config['DATA_DIR'])
            excel_path = data_dir / 'managed_updates' / 'askdrugtox_update.xlsx'
            print(f"  [i] Looking for data in: {excel_path}")
            
            if not excel_path.exists():
                print(f"  [!] ERROR: Path does not exist!")
                raise FileNotFoundError(f"Excel file not found at {excel_path}")

            print(f"  [+] Reading {excel_path}...")
            update_progress(task_id, 15, "Reading Excel data...")
            df = pd.read_excel(excel_path)

            # Fill NaN values to prevent import issues
            df = df.fillna('')

            # Basic Cleaning
            df.columns = [c.replace(' ', '_').replace('/', '_').replace('(', '').replace(')', '').replace('-', '_') for c in df.columns]
            
            if 'SETID' not in df.columns:
                raise ValueError("SETID column missing from Excel file.")

            print("  [+] Calculating historical flags...")
            update_progress(task_id, 35, "Processing historical flags...")
            
            df['SETID'] = df['SETID'].astype(str).str.strip()
            df['Tox_Type'] = df['Tox_Type'].astype(str).str.strip()
            df['SPL_Effective_Time_Clean'] = df['SPL_Effective_Time'].astype(str).str.replace('.0', '', regex=False).str.strip()

            # Sort descending by effective time so latest is kept first
            df = df.sort_values(
                by=['SETID', 'Tox_Type', 'SPL_Effective_Time_Clean'],
                ascending=[True, True, False]
            )

            df['is_historical'] = df.duplicated(
                subset=['SETID', 'Tox_Type'], 
                keep='first'
            ).astype(int)

            # 1. Upsert sum_spl metadata
            print("  [+] Upserting label metadata in sum_spl...")
            update_progress(task_id, 45, "Upserting sum_spl metadata...")

            metadata_df = df.drop_duplicates(subset=['SETID'])
            unique_setids = metadata_df['SETID'].tolist()

            existing_labels = DrugLabel.query.filter(DrugLabel.set_id.in_(unique_setids)).all()
            label_map = {}
            for label in existing_labels:
                label_map.setdefault(label.set_id, []).append(label)

            for _, row in metadata_df.iterrows():
                set_id = str(row['SETID']).strip()
                if not set_id:
                    continue
                
                trade_name = str(row.get('Trade_Name', '')).strip()
                generic_name = str(row.get('Generic_Proper_Names', '')).strip()
                manufacturer = str(row.get('Author_Organization', '')).strip()
                
                raw_time = str(row.get('SPL_Effective_Time', '')).replace('.0', '').strip()
                if len(raw_time) >= 8 and raw_time[:8].isdigit():
                    revised_date = f"{raw_time[:4]}-{raw_time[4:6]}-{raw_time[6:8]}"
                    effective_time_raw = raw_time[:8]
                else:
                    revised_date = raw_time if raw_time else None
                    effective_time_raw = raw_time if raw_time else None

                existing_list = label_map.get(set_id, [])
                if existing_list:
                    # Find matching effective time or fallback to latest
                    matched = None
                    for label in existing_list:
                        if label.effective_time_raw == effective_time_raw:
                            matched = label
                            break
                    if not matched:
                        existing_list.sort(key=lambda x: x.revised_date or '', reverse=True)
                        matched = existing_list[0]
                    
                    matched.product_names = trade_name
                    matched.generic_names = generic_name
                    matched.manufacturer = manufacturer
                    if revised_date:
                        matched.revised_date = revised_date
                    if effective_time_raw:
                        matched.effective_time_raw = effective_time_raw
                else:
                    new_label = DrugLabel(
                        spl_id=set_id,
                        set_id=set_id,
                        product_names=trade_name,
                        generic_names=generic_name,
                        manufacturer=manufacturer,
                        revised_date=revised_date,
                        effective_time_raw=effective_time_raw,
                        local_path='imported_drugtox'
                    )
                    db.session.add(new_label)

            db.session.commit()

            # 2. Import DrugToxicity records
            print(f"  [+] Importing {len(df)} records...")
            update_progress(task_id, 60, f"Importing {len(df)} records...")
            
            objects = []
            batch_size = 500
            total_count = 0
            total_rows = len(df)
            
            for i, (_, row) in enumerate(df.iterrows()):
                update_notes = str(row.get('Update_Notes', ''))
                assessment_date = ''
                date_match = re.search(r'(\d{2}/\d{2}/\d{4})', update_notes)
                if date_match:
                    try:
                        dt_obj = datetime.strptime(date_match.group(1), '%m/%d/%Y')
                        assessment_date = dt_obj.strftime('%Y%m%d')
                    except ValueError:
                        pass

                data = {
                    'SETID': str(row['SETID']),
                    'Toxicity_Class': str(row.get('Toxicity_Class', '')),
                    'Tox_Type': str(row.get('Tox_Type', '')),
                    'is_historical': int(row.get('is_historical', 0)),
                    'Update_Notes': update_notes if update_notes else None,
                    'AI_Summary': str(row.get('AI_Summary', '')) if pd.notna(row.get('AI_Summary')) else None,
                    'endpoint': str(row.get('endpoint', '')) if pd.notna(row.get('endpoint')) else None,
                    'Evidence': str(row.get('Evidence', '')) if pd.notna(row.get('Evidence')) else None,
                    'AI_Model': str(row.get('AI_Model', 'vLLM (Llama-4)')) if pd.notna(row.get('AI_Model')) else 'vLLM (Llama-4)',
                    'Assessment_Date': assessment_date if assessment_date else None
                }
                objects.append(data)
                
                if len(objects) >= batch_size:
                    db.session.bulk_insert_mappings(DrugToxicity, objects)
                    db.session.commit()
                    total_count += len(objects)
                    prog = 60 + int(30 * (i / total_rows))
                    update_progress(task_id, prog)
                    objects = []
            
            if objects:
                db.session.bulk_insert_mappings(DrugToxicity, objects)
                db.session.commit()

            # Refresh version lineage for the labels
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
                
            update_progress(task_id, 100, "DrugTox import complete.", status='completed')
            print(f"\n[!] Success! Imported records.")
            
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
    import_drugtox()
