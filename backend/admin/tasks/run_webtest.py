import argparse
import sys
import os
import time
import requests
import re
from datetime import datetime
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Add backend directory to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')))

from app import create_unified_app as create_app
from database import db, SystemTask
from database.models import WebtestTask, WebtestHistory

def get_api_url(ui_url, version=""):
    """Translates a FDALabel UI URL to its corresponding JSON Service URL."""
    if "fdalabel" not in ui_url.lower():
        return ui_url
    
    is_ldt = "CDER" in (version or "").upper() or "/fdalabel-r/" in ui_url.lower()
    base_service = "/services/spl/ldt/summaries/json/" if is_ldt else "/services/spl/summaries/json/"
    criteria_service = "/services/spl/ldt/summaries/json/criteria/" if is_ldt else "/services/spl/summaries/json/criteria/"

    if "/ui/spl-summaries/criteria/" in ui_url:
        return ui_url.replace("/ui/spl-summaries/criteria/", criteria_service)
    if "/ui/spl-summaries/" in ui_url:
        return ui_url.replace("/ui/spl-summaries/", base_service)
    if "/ui/search" in ui_url:
        return ui_url.replace("/ui/search", "/services/spl/search")
    if "/ui/spl-doc/" in ui_url:
        return ui_url.replace("/ui/spl-doc/", "/services/spl/set-ids/")
    return ui_url

def update_progress(task_id, progress, msg):
    if not task_id: return
    try:
        t = SystemTask.query.get(task_id)
        if t:
            if t.status == 'cancelled':
                sys.exit(0)
            t.progress = progress
            t.message = msg
            db.session.commit()
            print(f"Task {task_id} Progress: {progress}% - {msg}")
    except Exception as e:
        print(f"Error updating progress: {e}")

def main():
    parser = argparse.ArgumentParser(description='Run Webtest Automation')
    parser.add_argument('--task-id', type=int)
    args = parser.parse_args()

    app = create_app()
    with app.app_context():
        try:
            tasks = WebtestTask.query.order_by(WebtestTask.id).all()
            total_tasks = len(tasks)
            if total_tasks == 0:
                update_progress(args.task_id, 100, "No tasks found in database.")
                return

            update_progress(args.task_id, 5, f"Starting automation for {total_tasks} tasks...")

            session = requests.Session()
            session.headers.update({
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*'
            })

            now = datetime.utcnow()

            for i, task in enumerate(tasks):
                # Check for cancellation
                if args.task_id:
                    t = SystemTask.query.get(args.task_id)
                    if t and t.status == 'cancelled':
                        print("Task cancelled by user.")
                        sys.exit(0)

                url = task.url
                version = task.version
                api_url = get_api_url(url, version)
                
                server = "PROD"
                if "dev" in url.lower(): server = "DEV"
                elif "tst" in url.lower() or "test" in url.lower(): server = "TEST"

                start_time = time.time()
                count_str = "N/A"
                elapsed = 0.0
                status_msg = ""
                query_results = ""

                try:
                    resp = session.get(api_url, timeout=(5, 45), verify=False)
                    elapsed = round(time.time() - start_time, 2)
                    
                    if resp.status_code == 200:
                        try:
                            data = resp.json()
                            total = None
                            if isinstance(data, dict):
                                total = data.get('totalResultsCount')
                                if total is None: total = data.get('total') or data.get('count') or data.get('totalResults') or data.get('recordCount')
                            elif isinstance(data, list): total = len(data)
                            
                            if total is not None:
                                count_str = str(total)
                                query_results = f"{count_str} labeling results"
                                status_msg = "Success"
                            else:
                                count_str = "N/A"
                                status_msg = "Format Error"
                        except:
                            if "labeling results" in resp.text.lower():
                                match = re.search(r'(\d+)\s+Labeling Results', resp.text, re.IGNORECASE)
                                count_str = match.group(1) if match else "Found"
                                query_results = f"{count_str} labeling results" if count_str != "Found" else count_str
                                status_msg = "Success"
                            else:
                                count_str = "N/A"
                                status_msg = "Format Error"
                    elif resp.status_code == 404:
                        status_msg = "Not Found (404)"
                    else:
                        status_msg = f"HTTP {resp.status_code}"
                except Exception as e:
                    elapsed = round(time.time() - start_time, 2)
                    status_msg = "Inaccessible"

                h = WebtestHistory(
                    task_id=task.id,
                    server=server,
                    version=version,
                    url=url,
                    query_results=query_results if query_results else count_str,
                    delay=elapsed,
                    query_date=now,
                    query_details=task.query_details,
                    count=count_str,
                    notes=f"Auto-run ({status_msg})"
                )
                db.session.add(h)
                db.session.commit()

                progress = 5 + int(((i + 1) / total_tasks) * 90)
                update_progress(args.task_id, progress, f"Processed {i + 1}/{total_tasks} tasks.")
                time.sleep(0.5)

            update_progress(args.task_id, 100, f"Successfully completed {total_tasks} tasks.")
            
            if args.task_id:
                t = SystemTask.query.get(args.task_id)
                if t:
                    t.status = 'completed'
                    t.completed_at = datetime.utcnow()
                    db.session.commit()

        except Exception as e:
            print(f"Failed to run webtest automation: {e}")
            if args.task_id:
                t = SystemTask.query.get(args.task_id)
                if t:
                    t.status = 'failed'
                    t.error_details = str(e)
                    db.session.commit()

if __name__ == '__main__':
    main()
