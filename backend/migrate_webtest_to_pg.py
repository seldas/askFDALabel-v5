import os
import sys
import pandas as pd
from datetime import datetime

# We are in the backend directory, so we don't need to append '..'
from app import create_unified_app as create_app
from database import db
from database.models import WebtestTask, WebtestHistory

def parse_history_datetime(val):
    if val is None or pd.isna(val):
        return None
    s = str(val).strip()
    if not s or s.lower() in ("nat", "nan"):
        return None
    try:
        if "," in s:
            return datetime.strptime(s, "%Y/%m/%d, %H:%M")
        return pd.to_datetime(s).to_pydatetime()
    except Exception:
        return None

def migrate_unified(app_context):
    webtest_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), 'webtest'))
    history_dir = os.path.join(webtest_dir, 'history')
    
    # 1. Collect all unique URLs across both templates and history files
    unique_tasks_map = {} # url -> query_details
    
    # Check templates
    if os.path.exists(webtest_dir):
        files = [f for f in os.listdir(webtest_dir) if f.lower().endswith('.xlsx')]
        for f in files:
            filepath = os.path.join(webtest_dir, f)
            try:
                df = pd.read_excel(filepath).fillna('N/A')
                last_query_details = "N/A"
                for _, row in df.iterrows():
                    current_url = str(row.get('Result Link', '')).strip()
                    if not current_url or current_url == 'N/A': continue
                    
                    current_details = str(row.get('Query Details', 'N/A')).strip()
                    if current_details == 'N/A' or not current_details:
                        current_details = last_query_details
                    else:
                        last_query_details = current_details
                        
                    if current_url not in unique_tasks_map:
                        unique_tasks_map[current_url] = current_details
            except Exception as e:
                print(f"Error parsing template {f}: {e}")

    # Check histories
    if os.path.exists(history_dir):
        files = [f for f in os.listdir(history_dir) if f.lower().endswith('.xlsx')]
        for f in files:
            filepath = os.path.join(history_dir, f)
            try:
                df = pd.read_excel(filepath).fillna('N/A')
                for _, row in df.iterrows():
                    url = str(row.get('URL', '')).strip()
                    if not url or url == 'N/A': continue
                    if url not in unique_tasks_map:
                        unique_tasks_map[url] = str(row.get('query Detail', row.get('Query Details', ''))).strip()
            except Exception as e:
                print(f"Error parsing history {f}: {e}")

    print(f"Found {len(unique_tasks_map)} unique tasks across all files.")

    # Clear everything just in case (optional, we're building from scratch)
    WebtestHistory.query.delete()
    WebtestTask.query.delete()
    db.session.commit()

    from webtest.blueprint import get_combined_version

    # Insert unique tasks
    tasks_to_add = []
    for url, details in unique_tasks_map.items():
        task = WebtestTask(
            url=url,
            query_details=details if details != 'N/A' else '',
            version=get_combined_version(url)
        )
        tasks_to_add.append(task)
    
    db.session.bulk_save_objects(tasks_to_add)
    db.session.commit()
    print("Tasks successfully inserted.")

    # 2. Re-fetch to get IDs
    tasks_db = WebtestTask.query.all()
    url_to_task_id = {t.url: t.id for t in tasks_db}

    # 3. Insert history
    if os.path.exists(history_dir):
        files = [f for f in os.listdir(history_dir) if f.lower().endswith('.xlsx') and (f.startswith('History_') or f.startswith('Old_testing_report'))]
        for f in files:
            filepath = os.path.join(history_dir, f)
            try:
                is_old_report = f.startswith('Old_testing_report')
                df = pd.read_excel(filepath)
                histories_to_add = []
                for _, row in df.iterrows():
                    url = str(row.get('URL', '')).strip()
                    task_id = url_to_task_id.get(url)
                    if not task_id: continue

                    dt_val = row.get('Date')
                    if pd.isna(dt_val) or str(dt_val).strip() == "" or str(dt_val).lower() in ("nat", "nan"):
                        dt_val = row.get('Query_Date', '')
                    record_dt = parse_history_datetime(dt_val)

                    count = row.get('Count')
                    if pd.isna(count) or str(count).lower() == 'nan':
                        import re
                        qr = str(row.get('Query Results', ''))
                        m = re.search(r'(\d+)', qr)
                        count = m.group(1) if m else "0"

                    delay = row.get('Delay')
                    if pd.isna(delay):
                        delay = row.get('Result Time (Minimum 1s)', 0)
                    
                    delay_val = float(delay) if not pd.isna(delay) and str(delay).strip() != '' else 0.0

                    notes_val = str(row.get('Notes', ''))
                    if notes_val == 'nan' or not notes_val.strip() or notes_val == 'N/A':
                        notes_val = ""
                    
                    if is_old_report:
                        notes_val = "Migrated from HPC testing result"

                    query_details = str(row.get('query Detail', row.get('Query Details', '')))
                    if query_details == 'nan':
                        query_details = ''

                    h = WebtestHistory(
                        task_id=task_id,
                        server=str(row.get('Server', '')),
                        version=str(row.get('Version', 'N/A')),
                        url=url,
                        query_results=str(row.get('Query Results', '')),
                        delay=delay_val,
                        query_date=record_dt or datetime.utcnow(),
                        query_details=query_details,
                        count=str(count),
                        notes=notes_val
                    )
                    histories_to_add.append(h)

                # Insert in chunks
                chunk_size = 1000
                for i in range(0, len(histories_to_add), chunk_size):
                    db.session.bulk_save_objects(histories_to_add[i:i+chunk_size])
                db.session.commit()
                print(f"Added {len(histories_to_add)} history records from: {f}")
            except Exception as e:
                print(f"Error parsing history file {f}: {e}")

if __name__ == '__main__':
    app = create_app()
    with app.app_context():
        # Drop existing webtest tables safely
        from sqlalchemy import text
        print("Dropping old webtest tables if they exist...")
        db.session.execute(text('DROP TABLE IF EXISTS webtest_histories CASCADE;'))
        db.session.execute(text('DROP TABLE IF EXISTS webtest_tasks CASCADE;'))
        db.session.execute(text('DROP TABLE IF EXISTS webtest_templates CASCADE;'))
        db.session.commit()

        # First ensure schema is created (for webtest tables)
        db.create_all()
        print("Migrating unified Webtest Tasks and History...")
        migrate_unified(app)
        print("\nMigration Complete!")
