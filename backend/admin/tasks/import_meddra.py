import os
import sys
import argparse
from datetime import datetime, timezone
from pathlib import Path
from sqlalchemy import text

# Add backend to path
backend_dir = Path(__file__).resolve().parent.parent.parent
sys.path.append(str(backend_dir))

from database import (
    db, MeddraSOC, MeddraHLGT, MeddraHLT, MeddraPT, MeddraLLT, 
    MeddraMDHIER, MeddraSMQList, MeddraSMQContent, SystemTask
)
from dashboard import create_app

def update_progress(task_id, progress, message=None, status='processing'):
    if not task_id:
        return
    try:
        task = db.session.get(SystemTask, task_id)
        if task:
            if task.status == 'cancelled':
                import sys
                sys.exit(0)
                
            task.progress = progress
            if message:
                task.message = message
            task.status = status
            task.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
            if status == 'completed':
                now = datetime.now(timezone.utc).replace(tzinfo=None)
                task.completed_at = now
                try:
                    from database.models import DatabaseUpdateLog
                    db.session.add(DatabaseUpdateLog(
                        db_type='meddra',
                        completed_at=now,
                        status='completed',
                        message=message or 'MedDRA import complete.'
                    ))
                except Exception as log_err:
                    print(f"[WARN] Failed to write DatabaseUpdateLog: {log_err}")
            db.session.commit()
    except Exception as e:
        print(f"Error updating progress: {e}")

def parse_int(value):
    if not value or value.strip() == '':
        return None
    try:
        return int(value)
    except ValueError:
        return None

def process_file(file_name, model_class, field_mapping, data_dir, task_id, start_prog, end_prog, batch_size=10000):
    file_path = os.path.join(data_dir, file_name)
    if not os.path.exists(file_path):
        print(f"  [!] Skipping {file_name}: File not found")
        return

    table_name = model_class.__tablename__
    print(f"  [+] Importing {file_name} into {table_name}...")
    update_progress(task_id, start_prog, f"Importing {file_name}...")
    
    objects = []
    count = 0
    total_count = 0
    
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
            total_lines = len(lines)
            
            for i, line in enumerate(lines):
                parts = line.strip().split('$')
                data = {}
                for field, index in field_mapping.items():
                    if index < len(parts):
                        val = parts[index]
                        col = getattr(model_class, field)
                        if str(col.type).upper().startswith('INT'):
                            data[field] = parse_int(val)
                        else:
                            data[field] = val if val != '' else None
                
                objects.append(data)
                count += 1
                
                if count >= batch_size:
                    db.session.bulk_insert_mappings(model_class, objects)
                    db.session.commit()
                    total_count += count
                    # Calculate sub-progress
                    current_prog = int(start_prog + (end_prog - start_prog) * (i / total_lines))
                    update_progress(task_id, current_prog)
                    objects = []
                    count = 0
            
            if objects:
                db.session.bulk_insert_mappings(model_class, objects)
                db.session.commit()
                total_count += count
                
    except Exception as e:
        print(f"  [!] Error processing {file_name}: {e}")
        db.session.rollback()
        raise e

def run_import():
    parser = argparse.ArgumentParser(description='Import MedDRA data into PostgreSQL')
    parser.add_argument('--force', action='store_true', help='Force update')
    parser.add_argument('--task-id', type=int, help='SystemTask ID')
    args = parser.parse_args()

    app = create_app()
    with app.app_context():
        task_id = args.task_id
        try:
            print(f"=== MedDRA Data Importer (Task-Enabled) ===")
            print(f"  [i] Started at: {datetime.now(timezone.utc).replace(tzinfo=None)}")
            update_progress(task_id, 5, "Starting MedDRA import...")
            
            if args.force:
                print(f"  [-] Force update: Dropping MedDRA tables...")
                tables = [
                    'meddra_smq_content', 'meddra_smq_list', 'meddra_mdhier', 
                    'meddra_llt', 'meddra_pt', 'meddra_hlt', 'meddra_hlgt', 'meddra_soc'
                ]
                for table in tables:
                    db.session.execute(text(f"DROP TABLE IF EXISTS {table} CASCADE"))
                db.session.commit()
                db.create_all()

            data_dir = Path(app.config['DATA_DIR']) / 'monthly_updates' / 'MedDRA' / 'MedDRA_latest' / 'MedAscii'
            print(f"  [i] Looking for data in: {data_dir}")
            
            if not data_dir.exists():
                print(f"  [!] ERROR: Path does not exist!")
                raise FileNotFoundError(f"MedDRA directory not found at {data_dir}")

            # Import steps (distributed progress 10% to 95%)
            steps = [
                ('soc.asc', MeddraSOC, {
                    'soc_code': 0, 'soc_name': 1, 'soc_abbrev': 2, 'soc_whoart_code': 3,
                    'soc_harts_code': 4, 'soc_costart_code': 5, 'soc_icd9_code': 6,
                    'soc_icd9cm_code': 7, 'soc_icd10_code': 8, 'soc_currency': 9
                }, 10, 20),
                ('hlgt.asc', MeddraHLGT, {
                    'hlgt_code': 0, 'hlgt_name': 1, 'hlgt_whoart_code': 2, 'hlgt_harts_code': 3,
                    'hlgt_costart_code': 4, 'hlgt_icd9_code': 5, 'hlgt_icd9cm_code': 6,
                    'hlgt_icd10_code': 7, 'hlgt_currency': 8
                }, 20, 30),
                ('hlt.asc', MeddraHLT, {
                    'hlt_code': 0, 'hlt_name': 1, 'hlt_whoart_code': 2, 'hlt_harts_code': 3,
                    'hlt_costart_code': 4, 'hlt_icd9_code': 5, 'hlt_icd9cm_code': 6,
                    'hlt_icd10_code': 7, 'hlt_currency': 8
                }, 30, 40),
                ('pt.asc', MeddraPT, {
                    'pt_code': 0, 'pt_name': 1, 'null_field': 2, 'pt_soc_code': 3,
                    'pt_whoart_code': 4, 'pt_harts_code': 5, 'pt_costart_code': 6,
                    'pt_icd9_code': 7, 'pt_icd9cm_code': 8, 'pt_icd10_code': 9, 'pt_currency': 10
                }, 40, 55),
                ('llt.asc', MeddraLLT, {
                    'llt_code': 0, 'llt_name': 1, 'pt_code': 2, 'llt_whoart_code': 3,
                    'llt_harts_code': 4, 'llt_costart_code': 5, 'llt_icd9_code': 6,
                    'llt_icd9cm_code': 7, 'llt_icd10_code': 8, 'llt_currency': 9
                }, 55, 75),
                ('mdhier.asc', MeddraMDHIER, {
                    'pt_code': 0, 'hlt_code': 1, 'hlgt_code': 2, 'soc_code': 3,
                    'pt_name': 4, 'hlt_name': 5, 'hlgt_name': 6, 'soc_name': 7,
                    'soc_abbrev': 8, 'null_field': 9, 'pt_soc_code': 10, 'primary_soc_fg': 11
                }, 75, 85),
                ('smq_list.asc', MeddraSMQList, {
                    'smq_code': 0, 'smq_name': 1, 'smq_level': 2, 'smq_description': 3,
                    'smq_source': 4, 'smq_note': 5, 'meddra_version': 6, 'status': 7, 'smq_algorithm': 8
                }, 85, 90),
                ('smq_content.asc', MeddraSMQContent, {
                    'smq_code': 0, 'term_code': 1, 'term_level': 2, 'term_scope': 3,
                    'term_category': 4, 'term_weight': 5, 'term_status': 6,
                    'term_addition_version': 7, 'term_last_modified_version': 8
                }, 90, 95)
            ]

            for file, model, mapping, start, end in steps:
                process_file(file, model, mapping, str(data_dir), task_id, start, end)

            update_progress(task_id, 100, "MedDRA import complete.", status='completed')
            print("\n[!] MedDRA Population complete.")

        except Exception as e:
            print(f"Error during import: {e}")
            if task_id:
                try:
                    task = db.session.get(SystemTask, task_id)
                    if task:
                        task.status = 'failed'
                        task.error_details = str(e)
                        db.session.commit()
                except:
                    pass

if __name__ == '__main__':
    run_import()
