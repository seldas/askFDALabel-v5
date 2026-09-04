import os
import sys
import argparse
from datetime import datetime, timezone
from pathlib import Path
from sqlalchemy import text

# Add backend to path
backend_dir = Path(__file__).resolve().parent.parent.parent
sys.path.append(str(backend_dir))

from database import db, OrangeBook, SystemTask
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
            task.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
            if status == 'completed':
                now = datetime.now(timezone.utc).replace(tzinfo=None)
                task.completed_at = now
                try:
                    from database.models import DatabaseUpdateLog
                    db.session.add(DatabaseUpdateLog(
                        db_type='orangebook',
                        completed_at=now,
                        status='completed',
                        message=message or 'Orange Book import complete.'
                    ))
                except Exception as log_err:
                    print(f"[WARN] Failed to write DatabaseUpdateLog: {log_err}")
            db.session.commit()
    except Exception as e:
        print(f"Error updating progress: {e}")

def import_orangebook():
    parser = argparse.ArgumentParser(description='Import Orange Book data')
    parser.add_argument('--force', action='store_true')
    parser.add_argument('--task-id', type=int)
    args = parser.parse_args()

    app = create_app()
    with app.app_context():
        task_id = args.task_id
        try:
            print("=== Orange Book Data Importer (Task-Enabled) ===")
            update_progress(task_id, 10, "Starting Orange Book import...")
            
            if args.force:
                print("  [-] Force update: Clearing Orange Book table...")
                db.session.execute(text("TRUNCATE TABLE orange_book RESTART IDENTITY CASCADE"))
                db.session.commit()

            data_dir = Path(app.config['DATA_DIR'])
            data_file = data_dir / 'monthly_updates' / 'OrangeBook' / 'EOB_Latest' / 'products.txt'
            
            if not data_file.exists():
                raise FileNotFoundError(f"Orange Book data not found at {data_file}")

            print(f"  [+] Reading {data_file}...")
            update_progress(task_id, 30, "Parsing products.txt...")
            
            # Count lines for progress bar
            with open(data_file, 'r', encoding='utf-8', errors='replace') as f:
                total_lines = sum(1 for _ in f) - 1 # Subtract header
            
            print(f"  [+] Importing {total_lines} records...")
            update_progress(task_id, 40, f"Importing {total_lines} records...")
            
            objects = []
            batch_size = 5000
            total_count = 0
            
            with open(data_file, 'r', encoding='utf-8', errors='replace') as f:
                header = f.readline() # Skip header
                for i, line in enumerate(f):
                    parts = line.strip().split('~')
                    if len(parts) < 14:
                        continue
                        
                    data = {
                        'ingredient': parts[0],
                        'df_route': parts[1],
                        'trade_name': parts[2],
                        'applicant': parts[3],
                        'strength': parts[4],
                        'appl_type': parts[5],
                        'appl_no': parts[6],
                        'product_no': parts[7],
                        'te_code': parts[8],
                        'approval_date': parts[9],
                        'rld': parts[10],
                        'rs': parts[11],
                        'type': parts[12],
                        'applicant_full_name': parts[13]
                    }
                    objects.append(data)
                    
                    if len(objects) >= batch_size:
                        db.session.bulk_insert_mappings(OrangeBook, objects)
                        db.session.commit()
                        total_count += len(objects)
                        prog = 40 + int(55 * (i / total_lines))
                        update_progress(task_id, prog)
                        objects = []
            
            if objects:
                db.session.bulk_insert_mappings(OrangeBook, objects)
                db.session.commit()
                total_count += len(objects)
                
            update_progress(task_id, 100, f"Orange Book import complete. {total_count} records.", status='completed')
            print(f"\n[!] Success! Imported {total_count} records.")
            
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
    import_orangebook()
