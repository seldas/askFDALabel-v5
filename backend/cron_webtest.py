#!/usr/bin/env python3
"""
Scheduled Webtest Automation Script
-----------------------------------
Designed to be executed automatically by crontab (e.g., every Monday)
or manually by backend operators.

Crontab Configuration Examples (Run every Monday at 02:00 UTC):
    # Option 1: Via Docker Compose (Recommended if running in containers)
    0 2 * * 1 cd /compute001/lwu/Docker/FDALabel_v3 && docker compose exec -T backend python cron_webtest.py >> /compute001/lwu/Docker/FDALabel_v3/data/logs/cron_webtest.log 2>&1

    # Option 2: Via Docker container name directly
    0 2 * * 1 docker exec -i fdalabel-v3-backend python cron_webtest.py >> /compute001/lwu/Docker/FDALabel_v3/data/logs/cron_webtest.log 2>&1

    # Option 3: Directly on host with Python virtual environment
    0 2 * * 1 cd /compute001/lwu/Docker/FDALabel_v3 && /compute001/lwu/Docker/FDALabel_v3/venv/bin/python backend/cron_webtest.py >> /compute001/lwu/Docker/FDALabel_v3/data/logs/cron_webtest.log 2>&1

Features:
    - Auto-detects repository root and loads .env
    - Checks concurrency (prevents overlapping test runs)
    - Records execution progress in SystemTask for dashboard tracking
    - Overwrites previous test results of the same day (1 result per task per day)
    - Supports --dry-run, --force, and --verbose flags
"""

import os
import sys
import time
import json
import argparse
import requests
import re
from datetime import datetime, timezone
from pathlib import Path
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Dynamic path resolution to support execution from any directory
current_dir = Path(__file__).resolve().parent
repo_root = current_dir
for parent in [current_dir] + list(current_dir.parents):
    if (parent / '.env').exists() or (parent / '.env.template.txt').exists():
        repo_root = parent
        break

backend_dir = repo_root / 'backend' if (repo_root / 'backend').exists() else repo_root
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from app import create_unified_app
from database import db, SystemTask
from database.models import WebtestTask, WebtestHistory


def get_api_url(ui_url: str, version: str = "") -> str:
    """Translates a FDALabel UI URL to its corresponding JSON Service URL."""
    if not ui_url or "fdalabel" not in ui_url.lower():
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


def update_system_task(task_id: int, progress: int, msg: str, status: str = None, error: str = None, result_data: dict = None):
    """Updates the SystemTask record in the database if task_id is present."""
    if not task_id:
        return
    try:
        t = SystemTask.query.get(task_id)
        if t:
            t.progress = progress
            t.message = msg
            if status:
                t.status = status
            if status == 'completed':
                t.completed_at = datetime.now(timezone.utc).replace(tzinfo=None)
            if error:
                t.error_details = str(error)
            if result_data:
                t.result_data = json.dumps(result_data)
            db.session.commit()
    except Exception as e:
        print(f"[WARN] Failed to update SystemTask {task_id}: {e}", file=sys.stderr)


def run_webtest_automation(dry_run: bool = False, force: bool = False, verbose: bool = False):
    """Executes the full webtest regression suite."""
    start_ts = datetime.now(timezone.utc).replace(tzinfo=None)
    print(f"[{start_ts.strftime('%Y-%m-%d %H:%M:%S UTC')}] === Starting Scheduled Webtest Automation ===")
    if dry_run:
        print("[INFO] DRY-RUN MODE: No database records will be modified.")

    # 1. Concurrency Check
    active_tasks = SystemTask.query.filter(
        SystemTask.task_type == 'webtest',
        SystemTask.status.in_(['pending', 'processing'])
    ).all()

    if active_tasks and not force:
        msg = f"Another Webtest task is already in progress (SystemTask IDs: {[t.id for t in active_tasks]}). Use --force to override."
        print(f"[WARN] {msg}")
        return False

    # 2. Create SystemTask for tracking
    system_task = None
    if not dry_run:
        system_task = SystemTask(
            task_type='webtest',
            status='processing',
            progress=5,
            message='Scheduled Weekly Webtest Automation running...'
        )
        db.session.add(system_task)
        db.session.commit()
        print(f"[INFO] Created SystemTask ID: {system_task.id}")

    task_id = system_task.id if system_task else None

    try:
        tasks = WebtestTask.query.order_by(WebtestTask.id).all()
        total_tasks = len(tasks)
        if total_tasks == 0:
            print("[WARN] No WebtestTask records found in database.")
            update_system_task(task_id, 100, "No tasks configured.", status='completed')
            return True

        session = requests.Session()
        session.headers.update({
            'User-Agent': 'Mozilla/5.0 (askFDALabel Weekly Automated Test Engine)',
            'Accept': 'application/json, text/plain, */*'
        })

        success_count = 0
        fail_count = 0
        total_delay = 0.0
        now = datetime.now(timezone.utc).replace(tzinfo=None)

        for i, task in enumerate(tasks):
            url = task.url
            version = task.version
            api_url = get_api_url(url, version)

            server = "PROD"
            if "dev" in url.lower():
                server = "DEV"
            elif "tst" in url.lower() or "test" in url.lower():
                server = "TEST"
            elif "nctr-crs.fda.gov" in url.lower():
                server = "PUBLIC"

            t0 = time.time()
            count_str = "N/A"
            elapsed = 0.0
            status_msg = ""
            query_results = ""

            try:
                resp = session.get(api_url, timeout=(5, 45), verify=False)
                elapsed = round(time.time() - t0, 2)
                total_delay += elapsed

                if resp.status_code == 200:
                    try:
                        data = resp.json()
                        total = None
                        if isinstance(data, dict):
                            total = data.get('totalResultsCount')
                            if total is None:
                                total = data.get('total') or data.get('count') or data.get('totalResults') or data.get('recordCount')
                        elif isinstance(data, list):
                            total = len(data)

                        if total is not None:
                            count_str = str(total)
                            query_results = f"{count_str} labeling results"
                            status_msg = "Success"
                            success_count += 1
                        else:
                            count_str = "N/A"
                            status_msg = "Format Error"
                            fail_count += 1
                    except Exception:
                        if "labeling results" in resp.text.lower():
                            match = re.search(r'(\d+)\s+Labeling Results', resp.text, re.IGNORECASE)
                            count_str = match.group(1) if match else "Found"
                            query_results = f"{count_str} labeling results" if count_str != "Found" else count_str
                            status_msg = "Success"
                            success_count += 1
                        else:
                            count_str = "N/A"
                            status_msg = "Format Error"
                            fail_count += 1
                elif resp.status_code == 404:
                    status_msg = "Not Found (404)"
                    fail_count += 1
                else:
                    status_msg = f"HTTP {resp.status_code}"
                    fail_count += 1
            except Exception as exc:
                elapsed = round(time.time() - t0, 2)
                total_delay += elapsed
                status_msg = f"Inaccessible: {type(exc).__name__}"
                fail_count += 1

            if verbose:
                print(f"  [{i+1}/{total_tasks}] Task #{task.id} ({server} - {task.query_details[:40]}...): {count_str} ({elapsed}s, {status_msg})")

            # Database write with same-day overwrite rule
            if not dry_run:
                # Remove any existing history for this task recorded today
                existing_for_today = WebtestHistory.query.filter(
                    WebtestHistory.task_id == task.id,
                    db.func.date(WebtestHistory.query_date) == now.date()
                ).all()
                for old_h in existing_for_today:
                    db.session.delete(old_h)

                new_h = WebtestHistory(
                    task_id=task.id,
                    server=server,
                    version=version,
                    url=url,
                    query_results=query_results if query_results else count_str,
                    delay=elapsed,
                    query_date=now,
                    query_details=task.query_details,
                    count=count_str,
                    notes=f"Cron-run ({status_msg})"
                )
                db.session.add(new_h)
                db.session.commit()

            progress = 5 + int(((i + 1) / total_tasks) * 90)
            update_system_task(task_id, progress, f"Processed {i + 1}/{total_tasks} tasks.")
            time.sleep(0.3)

        avg_delay = round(total_delay / total_tasks, 2) if total_tasks > 0 else 0
        total_time = round((datetime.now(timezone.utc).replace(tzinfo=None) - start_ts).total_seconds(), 1)
        summary = {
            'total_tasks': total_tasks,
            'success_count': success_count,
            'fail_count': fail_count,
            'avg_delay_seconds': avg_delay,
            'total_duration_seconds': total_time,
            'executed_at': now.strftime('%Y-%m-%d %H:%M:%S UTC')
        }

        print(f"[INFO] Completed {total_tasks} tasks in {total_time}s: {success_count} succeeded, {fail_count} failed/inaccessible (avg delay: {avg_delay}s).")
        update_system_task(
            task_id,
            100,
            f"Completed {total_tasks} tasks ({success_count} success, {fail_count} errors) in {total_time}s.",
            status='completed',
            result_data=summary
        )
        return True

    except Exception as e:
        print(f"[ERROR] Webtest automation failed: {e}", file=sys.stderr)
        update_system_task(task_id, 100, f"Automation failed: {str(e)}", status='failed', error=str(e))
        return False


def main():
    parser = argparse.ArgumentParser(
        description='askFDALabel Scheduled Webtest Runner',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Crontab Setup Examples (Run every Monday at 02:00 UTC):
  1) Docker Compose (Recommended):
     0 2 * * 1 cd /path/to/askFDALabel_v5 && docker compose exec -T backend python cron_webtest.py >> data/logs/cron_webtest.log 2>&1

  2) Docker Exec (Container name directly):
     0 2 * * 1 docker exec -i fdalabel-v3-backend python cron_webtest.py >> /path/to/askFDALabel_v5/data/logs/cron_webtest.log 2>&1

  3) Host Python Virtual Environment:
     0 2 * * 1 cd /path/to/askFDALabel_v5 && /path/to/venv/bin/python backend/cron_webtest.py >> data/logs/cron_webtest.log 2>&1
        """
    )
    parser.add_argument('--dry-run', action='store_true', help='Test endpoints without updating database')
    parser.add_argument('--force', action='store_true', help='Bypass concurrency lock')
    parser.add_argument('--verbose', '-v', action='store_true', help='Print verbose output for each task')

    args = parser.parse_args()

    app = create_unified_app()
    with app.app_context():
        success = run_webtest_automation(dry_run=args.dry_run, force=args.force, verbose=args.verbose)
        sys.exit(0 if success else 1)


if __name__ == '__main__':
    main()
