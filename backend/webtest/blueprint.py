from flask import Blueprint, request, jsonify, current_app, send_file
import os
import pandas as pd
from datetime import datetime
import urllib3
from flask_login import current_user
import subprocess
import sys

from database import db, SystemTask
from database.models import WebtestTask, WebtestHistory
from dashboard.services.task_service import TaskService

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

from dashboard.routes.guards import feature_before_request

webtest_bp = Blueprint('webtest', __name__)

# Gated on the blueprint rather than per route, so any route added later is
# covered by default. The required role is admin-configurable at runtime --
# see dashboard.services.feature_gates.
webtest_bp.before_request(feature_before_request('webtest'))

def get_cutoff_from_range(range_key: str):
    rk = (range_key or "1y").lower()
    now = datetime.now()
    if rk in ("all", "a"): return None
    if rk in ("5y", "5yr", "5yrs", "5years"): return (now - pd.DateOffset(years=5)).to_pydatetime()
    if rk in ("1y", "1yr", "1yrs", "1year"): return (now - pd.DateOffset(years=1)).to_pydatetime()
    if rk in ("6m", "6mo", "6mos", "6months"): return (now - pd.DateOffset(months=6)).to_pydatetime()
    if rk in ("3m", "3mo", "3mos", "3months"): return (now - pd.DateOffset(months=3)).to_pydatetime()
    return (now - pd.DateOffset(years=1)).to_pydatetime()

@webtest_bp.route('/tasks_info', methods=['GET'])
def get_tasks_info():
    tasks_db = WebtestTask.query.order_by(WebtestTask.id).all()
    
    # Get latest history for each task
    # Instead of a complex subquery, we can just load histories ordered by date 
    # or use distinct on task_id if postgres allows, but simplest is to do what we did:
    latest_histories = db.session.query(
        WebtestHistory.task_id, WebtestHistory.count, WebtestHistory.delay, WebtestHistory.query_date
    ).order_by(WebtestHistory.query_date.desc()).all()
    
    last_run_date = "N/A"
    history_map = {}
    for task_id, count, delay, qdate in latest_histories:
        if last_run_date == "N/A" and qdate:
            last_run_date = qdate.strftime("%Y/%m/%d, %H:%M")
        if task_id not in history_map:
            history_map[task_id] = {"count": count, "time": delay}

    tasks = []
    for t in tasks_db:
        h_data = history_map.get(t.id, {"count": "N/A", "time": 0.0})
        
        # Parse Server and Version from URL
        url_lower = (t.url or "").lower()
        
        # 1. Server
        if 'nctr-crs.fda.gov' in url_lower:
            server = 'PUBLIC'
        elif 'ncsvmlblapptst2' in url_lower:
            server = 'TEST'
        elif 'ncsvmdbbapp-dev' in url_lower:
            server = 'DEV'
        elif 'fdalabel.fda.gov' in url_lower:
            server = 'PROD'
        else:
            server = 'Unknown'
            
        # 2. Version
        if '/fdalabel-r/' in url_lower:
            app_ver = 'CDER-CBER'
        elif '/fdalabel/' in url_lower:
            app_ver = 'FDA'
        else:
            app_ver = 'FDA' # Default to FDA if we can't tell

        combined_version = f"{server} - {app_ver}"

        tasks.append({
            "task_id": t.id,
            "server": server,
            "version": combined_version,
            "url": t.url,
            "query_details": t.query_details,
            "status": "pending",
            "count": "N/A",
            "time_to_ready": 0,
            "prev_count": h_data["count"],
            "prev_time": h_data["time"]
        })
        
    return jsonify({
        "total_tasks": len(tasks), 
        "tasks": tasks,
        "last_run_date": last_run_date
    })

@webtest_bp.route('/start_test', methods=['POST'])
def start_test():
    if not current_user.is_authenticated:
        return jsonify({"error": "Unauthorized"}), 401
    
    # Concurrency check: reject if another test is currently running
    active_task = SystemTask.query.filter(
        SystemTask.task_type == 'webtest',
        SystemTask.status.in_(['pending', 'processing'])
    ).first()
    if active_task:
        return jsonify({
            "error": "A web test is already in progress. Please wait for it to complete.",
            "task_id": active_task.id,
            "running": True
        }), 409

    # Rate limiting: prevent rapid-fire triggering within 60s
    recent_task = SystemTask.query.filter(
        SystemTask.task_type == 'webtest',
        SystemTask.completed_at >= (datetime.utcnow() - pd.Timedelta(seconds=60))
    ).first()
    if recent_task:
        return jsonify({
            "error": "A web test was completed very recently. Please wait a moment before starting another run."
        }), 429

    new_task = TaskService.create_task(
        task_type='webtest',
        user_id=current_user.id,
        message='Starting Webtest Automation for all tasks...'
    )
    new_task.status = 'processing'
    db.session.commit()
    
    script_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'admin', 'tasks', 'run_webtest.py')
    venv_python = os.path.join(os.getcwd(), 'venv', 'bin', 'python3')
    if not os.path.exists(venv_python):
        venv_python = sys.executable
        
    cmd = [venv_python, script_path, '--task-id', str(new_task.id)]
    
    log_dir = os.path.join(current_app.config['DATA_DIR'], 'logs', 'tasks')
    os.makedirs(log_dir, exist_ok=True)
    log_file_path = os.path.join(log_dir, f'task_{new_task.id}.log')
    
    log_file = open(log_file_path, 'w')
    subprocess.Popen(
        cmd,
        stdout=log_file,
        stderr=subprocess.STDOUT,
        text=True,
        close_fds=True
    )
    
    return jsonify({
        'success': True,
        'task_id': new_task.id
    })

def get_combined_version(url):
    url_lower = (url or "").lower()
    if 'nctr-crs.fda.gov' in url_lower: server = 'PUBLIC'
    elif 'ncsvmlblapptst2' in url_lower: server = 'TEST'
    elif 'ncsvmdbbapp-dev' in url_lower: server = 'DEV'
    elif 'fdalabel.fda.gov' in url_lower: server = 'PROD'
    else: server = 'Unknown'
        
    if '/fdalabel-r/' in url_lower: app_ver = 'CDER-CBER'
    elif '/fdalabel/' in url_lower: app_ver = 'FDA'
    else: app_ver = 'FDA'
    return f"{server} - {app_ver}"

@webtest_bp.route('/task_history', methods=['GET'])
def get_task_history():
    task_id = request.args.get('task_id')
    range_key = request.args.get('range', '1y')
    
    if not task_id: return jsonify([])
    
    cutoff = get_cutoff_from_range(range_key)
    query = WebtestHistory.query.filter_by(task_id=task_id)
    if cutoff: query = query.filter(WebtestHistory.query_date >= cutoff)
        
    histories = query.order_by(WebtestHistory.query_date.desc()).all()
    
    # Deduplicate: only retain the latest test record for each calendar date
    seen_dates = set()
    deduped = []
    for h in histories:
        d = h.query_date.date() if h.query_date else None
        if d not in seen_dates:
            seen_dates.add(d)
            deduped.append(h)
            
    deduped.reverse()
    results = [{
        "Date": h.query_date.strftime("%Y-%m-%d %H:%M:%S") if h.query_date else "",
        "URL": h.url,
        "Version": get_combined_version(h.url),
        "Count": h.count,
        "Delay": h.delay,
        "Notes": h.notes
    } for h in deduped]
    return jsonify(results)

@webtest_bp.route('/group_history', methods=['GET'])
def get_group_history():
    query_details = request.args.get('query_details')
    range_key = request.args.get('range', '1y')
    
    if not query_details: return jsonify([])
    
    cutoff = get_cutoff_from_range(range_key)
    query = db.session.query(WebtestHistory).join(WebtestTask, WebtestHistory.task_id == WebtestTask.id).filter(WebtestTask.query_details == query_details)
    
    if cutoff: query = query.filter(WebtestHistory.query_date >= cutoff)
        
    histories = query.order_by(WebtestHistory.query_date.desc()).all()
    
    # Deduplicate: only retain the latest test record per task/version for each calendar date
    seen = set()
    deduped = []
    for h in histories:
        d = h.query_date.date() if h.query_date else None
        key = (h.task_id or h.url, d)
        if key not in seen:
            seen.add(key)
            deduped.append(h)
            
    deduped.reverse()
    results = [{
        "Date": h.query_date.strftime("%Y-%m-%d %H:%M:%S") if h.query_date else "",
        "URL": h.url,
        "Version": get_combined_version(h.url),
        "Count": h.count,
        "Delay": h.delay,
        "Notes": h.notes
    } for h in deduped]
    return jsonify(results)

@webtest_bp.route('/calendar_dates', methods=['GET'])
def get_calendar_dates():
    """Return a lightweight list of dates that have test results, with summary stats."""
    range_key = request.args.get('range', '1y')
    cutoff = get_cutoff_from_range(range_key)

    query = db.session.query(
        db.func.date(WebtestHistory.query_date).label('test_date'),
        db.func.count(db.func.distinct(WebtestHistory.task_id)).label('task_count')
    )
    if cutoff:
        query = query.filter(WebtestHistory.query_date >= cutoff)

    rows = query.group_by(db.func.date(WebtestHistory.query_date)).order_by(db.text('test_date DESC')).all()
    return jsonify([{"date": str(r.test_date), "run_count": r.task_count, "task_count": r.task_count} for r in rows])


@webtest_bp.route('/date_snapshot', methods=['GET'])
def get_date_snapshot():
    """For a given date, return a cross-tab of all tasks x versions with counts and delays."""
    date_str = request.args.get('date')
    if not date_str:
        return jsonify([])
    try:
        target_date = datetime.strptime(date_str, '%Y-%m-%d').date()
    except ValueError:
        return jsonify({"error": "Invalid date format, expected YYYY-MM-DD"}), 400

    tasks_db = WebtestTask.query.order_by(WebtestTask.id).all()
    task_num_map = {t.id: idx + 1 for idx, t in enumerate(tasks_db)}
    task_details_map = {t.id: t.query_details for t in tasks_db}

    # Map from query_details to a dict of version -> url
    task_urls_map = {}
    for t in tasks_db:
        qd = t.query_details or ''
        version = get_combined_version(t.url)
        if qd not in task_urls_map:
            task_urls_map[qd] = {}
        task_urls_map[qd][version] = t.url

    histories = db.session.query(WebtestHistory).filter(
        db.func.date(WebtestHistory.query_date) == target_date
    ).order_by(WebtestHistory.query_date.desc()).all()

    snapshot = {}
    for h in histories:
        qd = h.query_details or task_details_map.get(h.task_id, 'Unknown')
        version = get_combined_version(h.url)
        if qd not in snapshot:
            snapshot[qd] = {"task_id": h.task_id, "versions": {}}
        # If multiple runs exist on the same date, only keep the latest one
        if version not in snapshot[qd]["versions"]:
            snapshot[qd]["versions"][version] = {
                "latest": {"count": h.count, "delay": h.delay},
                "runs": [{
                    "count": h.count,
                    "delay": h.delay,
                    "time": h.query_date.strftime("%H:%M UTC") if h.query_date else "N/A",
                    "notes": h.notes
                }]
            }

    result = []
    for qd, data in snapshot.items():
        tid = data["task_id"]
        result.append({
            "task_id": tid,
            "task_num": task_num_map.get(tid, 0),
            "query_details": qd,
            "versions": data["versions"],
            "urls": task_urls_map.get(qd, {})
        })
    result.sort(key=lambda x: x["task_num"])
    return jsonify(result)


@webtest_bp.route('/download_history', methods=['POST'])
def download_history():
    from io import BytesIO
    data = request.get_json()
    start_date_str = data.get('start_date')
    end_date_str = data.get('end_date')
    
    query = WebtestHistory.query
    if start_date_str:
        start_dt = pd.to_datetime(start_date_str)
        query = query.filter(WebtestHistory.query_date >= start_dt)
    if end_date_str:
        end_dt = pd.to_datetime(end_date_str) + pd.Timedelta(days=1) - pd.Timedelta(microseconds=1)
        query = query.filter(WebtestHistory.query_date <= end_dt)
        
    histories = query.order_by(WebtestHistory.query_date.desc()).all()
    if not histories:
        return jsonify({"error": "No history found for this range."}), 404
        
    # Deduplicate: only retain the latest test record per task/version for each calendar date
    seen = set()
    deduped = []
    for h in histories:
        d = h.query_date.date() if h.query_date else None
        key = (h.task_id or h.url, d)
        if key not in seen:
            seen.add(key)
            deduped.append(h)
            
    deduped.reverse()
    df = pd.DataFrame([{
        "Environment": h.server,
        "App Version": h.version,
        "Query Details": h.query_details,
        "Result Count": h.count,
        "Delay (s)": h.delay,
        "Date Executed": h.query_date.strftime("%Y-%m-%d %H:%M:%S") if h.query_date else "",
        "Target URL": h.url,
        "Notes": h.notes
    } for h in deduped])
    
    output = BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='Testing Results')
        
    output.seek(0)
    
    return send_file(
        output, 
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 
        as_attachment=True, 
        download_name=f"webtest_history_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    )

@webtest_bp.route('/report_from_data', methods=['POST'])
def report_from_data():
    from io import BytesIO
    if not current_user.is_authenticated:
        return jsonify({"error": "Unauthorized"}), 401
    data = request.get_json()
    results = data.get('results', [])
    if not results: return jsonify({"error": "No data"}), 400
    
    now_str = datetime.now().strftime("%Y/%m/%d, %H:%M")
    username = current_user.username if current_user.is_authenticated else "Anonymous"
    formatted = []
    
    for r in results:
        combined_version = r.get('version', '')
        # combined_version is like "PROD - FDA", let's split it nicely or just fall back to url parsing
        url = r.get('url', '')
        
        env_str = "Unknown"
        app_str = "Unknown"
        if " - " in combined_version:
            parts = combined_version.split(" - ", 1)
            env_str = parts[0]
            app_str = parts[1]
        
        count_val = r.get('count', 'N/A')
        
        formatted.append({
            "Task ID": r.get('task_id'),
            "Environment": env_str,
            "App Version": app_str,
            "Query Details": r.get('query_details'),
            "Result Count": count_val,
            "Delay (s)": r.get('time_to_ready'),
            "Date Executed": now_str,
            "Target URL": url,
            "Notes": f"Manual run by {username}"
        })
        
    df = pd.DataFrame(formatted)
    output = BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='Testing Results')
    output.seek(0)
    return send_file(
        output, 
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 
        as_attachment=True, 
        download_name=f"webtest_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    )
