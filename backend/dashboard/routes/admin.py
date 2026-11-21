import os
import subprocess
import sys
import json
import uuid
from pathlib import Path
from flask import Blueprint, request, jsonify
from flask_login import login_required, current_user
from database import db, User, SystemTask, ROLES, ROLE_USER, utc_now
from dashboard.services.task_service import TaskService
from dashboard.services.data_files import FILE_TYPES, archive_and_replace, file_status, prepare_for_update, spec
from functools import wraps

admin_bp = Blueprint('admin', __name__)

def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not current_user.is_authenticated or not current_user.is_admin:
            return jsonify({'success': False, 'error': 'Admin privileges required'}), 403
        return f(*args, **kwargs)
    return decorated_function

# --- User Management ---

@admin_bp.route('/users', methods=['GET'])
@login_required
@admin_required
def get_users():
    users = User.query.options(db.selectinload(User.sso_identities)).all()
    return jsonify({
        'success': True,
        'users': [{
            'id': u.id,
            'username': u.username,
            'display_name': u.display_name,
            'email': u.sso_identities[0].email if u.sso_identities else None,
            'office': u.sso_identities[0].office if u.sso_identities else None,
            'is_sso': bool(u.sso_identities),
            'is_admin': u.is_admin,
            'role': u.effective_role,
            'can_select_db': u.can_select_database,
            'has_developer_access': u.has_developer_access,
            'ai_provider': u.ai_provider,
            'can_comment': getattr(u, 'can_comment', True),
            'is_active': getattr(u, 'is_active', True),
            'created_at': u.created_at.isoformat() if getattr(u, 'created_at', None) else None,
            'last_login': u.last_login.isoformat() if getattr(u, 'last_login', None) else None
        } for u in users]
    })

@admin_bp.route('/users', methods=['POST'])
@login_required
@admin_required
def create_user():
    data = request.get_json()
    username = (data.get('username') or '').strip().lower()
    password = data.get('password')
    # `role` is authoritative; `is_admin` is still honoured so an older client
    # that only knows the boolean keeps working.
    role = (data.get('role') or '').strip().lower()
    if not role:
        role = 'admin' if data.get('is_admin', False) else ROLE_USER
    if role not in ROLES:
        return jsonify({'success': False, 'error': f'Unknown role: {role}'}), 400

    if not username or not password:
        return jsonify({'success': False, 'error': 'Username and password required'}), 400

    if User.query.filter(db.func.lower(User.username) == username.lower()).first():
        return jsonify({'success': False, 'error': 'Username already exists'}), 400

    can_comment = data.get('can_comment', True)
    new_user = User(username=username, created_at=utc_now(), can_comment=bool(can_comment))
    new_user.set_role(role)
    new_user.set_password(password)
    db.session.add(new_user)
    db.session.commit()
    return jsonify({'success': True, 'user_id': new_user.id})

@admin_bp.route('/users/<int:user_id>', methods=['PUT'])
@login_required
@admin_required
def update_user(user_id):
    user = User.query.get_or_404(user_id)
    data = request.get_json()

    # set_role keeps is_admin in step, so role wins when both are sent.
    if 'role' in data:
        role = (data.get('role') or '').strip().lower()
        if role not in ROLES:
            return jsonify({'success': False, 'error': f'Unknown role: {role}'}), 400
        if user.id == current_user.id and role != 'admin' and user.is_admin:
            return jsonify({'success': False, 'error': 'Cannot remove your own admin role'}), 400
        user.set_role(role)
    elif 'is_admin' in data:
        if user.id == current_user.id and not data['is_admin'] and user.is_admin:
            return jsonify({'success': False, 'error': 'Cannot remove your own admin role'}), 400
        user.set_role('admin' if data['is_admin'] else ROLE_USER)
    if 'is_active' in data:
        user.is_active = data['is_active']
    if 'can_comment' in data:
        user.can_comment = bool(data['can_comment'])
    if 'password' in data and data['password']:
        if user.sso_identities:
            return jsonify({'success': False, 'error': 'SSO passwords are managed by the identity provider.'}), 400
        user.set_password(data['password'])
    if 'username' in data:
        new_username = (data['username'] or '').strip().lower()
        if new_username:
            existing = User.query.filter(db.func.lower(User.username) == new_username.lower(), User.id != user_id).first()
            if existing:
                return jsonify({'success': False, 'error': 'Username already exists'}), 400
            user.username = new_username
    if 'ai_provider' in data:
        from dashboard.services.ai_preferences import normalize_provider, allowed_providers
        provider = normalize_provider(data['ai_provider'])
        if provider and provider not in allowed_providers():
            return jsonify(success=False, error='This model is not available in this deployment.'), 400
        user.ai_provider = provider or None

    db.session.commit()
    return jsonify({'success': True})

@admin_bp.route('/users/<int:user_id>', methods=['DELETE'])
@login_required
@admin_required
def delete_user(user_id):
    if user_id == current_user.id:
        return jsonify({'success': False, 'error': 'Cannot delete yourself'}), 400
    
    try:
        user = User.query.get_or_404(user_id)
        
        if getattr(user, 'is_active', True):
            return jsonify({'success': False, 'error': 'Cannot permanently delete an active account. Please deactivate it first.'}), 400

        # Clean up related records that don't cascade automatically
        from database.models import TokenUsage, Project, Favorite, FavoriteComparison, LabelAnnotation, SystemTask
        
        TokenUsage.query.filter_by(user_id=user_id).delete()
        SystemTask.query.filter_by(user_id=user_id).delete()
        LabelAnnotation.query.filter_by(user_id=user_id).delete()
        FavoriteComparison.query.filter_by(user_id=user_id).delete()
        Favorite.query.filter_by(user_id=user_id).delete()
        
        # Safely delete owned projects via ORM so it cascades to project-children (e.g. project_ae_report)
        projects = Project.query.filter_by(owner_id=user_id).all()
        for p in projects:
            db.session.delete(p)
            
        db.session.delete(user)
        db.session.commit()
        return jsonify({'success': True})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': f"Database constraint error: {str(e)}. User likely has associated data."}), 500

# --- Database Updates ---

_FILE_TYPE_BY_UPDATE = {item['update_type']: key for key, item in FILE_TYPES.items()}


def _upload_dir():
    from flask import current_app
    path = Path(current_app.config['DATA_DIR']) / 'uploads' / '.resumable'
    path.mkdir(parents=True, exist_ok=True)
    return path


@admin_bp.route('/data_files', methods=['GET'])
@login_required
@admin_required
def list_data_files():
    from flask import current_app
    return jsonify({'success': True, 'files': [file_status(current_app.config['DATA_DIR'], key) for key in FILE_TYPES]})


@admin_bp.route('/data_files/upload/init', methods=['POST'])
@login_required
@admin_required
def init_data_file_upload():
    from flask import current_app
    data = request.get_json() or {}
    file_type, size = data.get('type'), data.get('size')
    try:
        item = spec(file_type)
        if not isinstance(size, int) or size <= 0 or size > 20 * 1024 ** 3:
            raise ValueError('File size must be between 1 byte and 20 GB')
        original_name = Path(str(data.get('name', ''))).name
        suffix = Path(original_name).suffix.lower()
        if suffix not in item['extensions']:
            raise ValueError(f"Expected {' or '.join(sorted(item['extensions']))} file")
        folder = _upload_dir()
        # Re-selecting the same file after interruption resumes its persisted
        # partial upload rather than sending already received chunks again.
        for old_meta_path in folder.glob('*.json'):
            old_meta = json.loads(old_meta_path.read_text(encoding='utf-8'))
            old_part = folder / f'{old_meta_path.stem}.part'
            if old_meta.get('type') == file_type and old_meta.get('size') == size and old_part.is_file():
                old_meta['received'] = min(old_meta.get('received', 0), old_part.stat().st_size)
                if original_name:
                    old_meta['original_name'] = original_name
                old_meta_path.write_text(json.dumps(old_meta), encoding='utf-8')
                return jsonify({'success': True, 'upload_id': old_meta_path.stem, 'received': old_meta['received']})
        upload_id = uuid.uuid4().hex
        meta = {'type': file_type, 'size': size, 'received': 0, 'original_name': original_name}
        (folder / f'{upload_id}.json').write_text(json.dumps(meta), encoding='utf-8')
        return jsonify({'success': True, 'upload_id': upload_id, 'received': 0})
    except ValueError as exc:
        return jsonify({'success': False, 'error': str(exc)}), 400


@admin_bp.route('/data_files/upload/<upload_id>/chunk', methods=['PUT'])
@login_required
@admin_required
def upload_data_file_chunk(upload_id):
    folder = _upload_dir()
    meta_path = folder / f'{upload_id}.json'
    if not meta_path.is_file():
        return jsonify({'success': False, 'error': 'Upload session not found'}), 404
    meta = json.loads(meta_path.read_text(encoding='utf-8'))
    try:
        offset = int(request.headers.get('X-Upload-Offset', '-1'))
    except ValueError:
        offset = -1
    chunk = request.get_data(cache=False)
    if offset != meta['received'] or not chunk or meta['received'] + len(chunk) > meta['size']:
        return jsonify({'success': False, 'error': 'Invalid upload chunk offset or size', 'received': meta['received']}), 409
    with open(folder / f'{upload_id}.part', 'ab') as stream:
        stream.write(chunk)
    meta['received'] += len(chunk)
    meta_path.write_text(json.dumps(meta), encoding='utf-8')
    return jsonify({'success': True, 'received': meta['received']})


@admin_bp.route('/data_files/upload/<upload_id>/complete', methods=['POST'])
@login_required
@admin_required
def complete_data_file_upload(upload_id):
    from flask import current_app
    folder, meta_path = _upload_dir(), _upload_dir() / f'{upload_id}.json'
    if not meta_path.is_file():
        return jsonify({'success': False, 'error': 'Upload session not found'}), 404
    meta = json.loads(meta_path.read_text(encoding='utf-8'))
    part = folder / f'{upload_id}.part'
    if meta['received'] != meta['size'] or not part.is_file() or part.stat().st_size != meta['size']:
        return jsonify({'success': False, 'error': 'Upload is incomplete', 'received': meta['received']}), 409
    from flask_login import current_user
    destination = archive_and_replace(
        current_app.config['DATA_DIR'],
        meta['type'],
        part,
        original_name=meta.get('original_name'),
        uploaded_by=getattr(current_user, 'username', None),
    )
    meta_path.unlink(missing_ok=True)
    return jsonify({'success': True, 'file': file_status(current_app.config['DATA_DIR'], meta['type']), 'path': str(destination)})


@admin_bp.route('/update_preflight/<db_type>', methods=['GET'])
@login_required
@admin_required
def update_preflight(db_type):
    from flask import current_app
    file_type = _FILE_TYPE_BY_UPDATE.get(db_type)
    if not file_type:
        return jsonify({'success': True, 'warning': None})
    status = file_status(current_app.config['DATA_DIR'], file_type)
    if status['exists'] and not status['stale']:
        warning = None
    elif not status['exists']:
        warning = f"{status['label']} is missing. Upload a current file before updating."
    else:
        warning = f"{status['label']} is {status['age_days']} days old. Upload a current file before updating."
    return jsonify({'success': True, 'file': status, 'warning': warning})

@admin_bp.route('/update_db', methods=['POST'])
@login_required
@admin_required
def trigger_db_update():
    data = request.get_json()
    db_type = data.get('type') # 'labeling', 'orangebook', 'drugtox', 'meddra'
    
    scripts = {
        'monthly_labeling': 'admin/tasks/import_monthly_labels.py',
        'labeling': 'admin/tasks/import_labels.py',
        'orangebook': 'admin/tasks/import_orangebook.py',
        'drugtox': 'admin/tasks/import_drugtox.py',
        'generate_drugtox': 'admin/tasks/generate_drugtox.py',
        'meddra': 'admin/tasks/import_meddra.py',
        'epc': 'admin/tasks/import_epc.py',
    }

    if db_type not in scripts:
        return jsonify({'success': False, 'error': 'Invalid database type'}), 400

    file_type = _FILE_TYPE_BY_UPDATE.get(db_type)
    if file_type:
        from flask import current_app
        source = file_status(current_app.config['DATA_DIR'], file_type)
        if (not source['exists'] or source['stale']) and not data.get('confirm_file_warning'):
            return jsonify({'success': False, 'requires_confirmation': True, 'file': source,
                            'error': 'Source file is missing or older than one month'}), 409
        if not source['exists']:
            return jsonify({'success': False, 'error': 'Cannot update without the required uploaded source file'}), 400
        try:
            prepare_for_update(current_app.config['DATA_DIR'], file_type)
        except Exception as exc:
            return jsonify({'success': False, 'error': f'Could not prepare uploaded source file: {exc}'}), 400

    # Create a new SystemTask
    new_task = TaskService.create_task(
        task_type=db_type,
        user_id=current_user.id,
        message=f'Starting {db_type} update...'
    )
    new_task.status = 'processing'
    db.session.commit()

    script_path = scripts[db_type]
    venv_python = os.path.join(os.getcwd(), 'venv', 'bin', 'python3')
    if not os.path.exists(venv_python):
        venv_python = sys.executable

    # Ensure log directory exists
    from flask import current_app
    log_dir = os.path.join(current_app.config['DATA_DIR'], 'logs', 'tasks')
    os.makedirs(log_dir, exist_ok=True)
    log_file_path = os.path.join(log_dir, f'task_{new_task.id}.log')

    try:
        # Pass --task-id to the script
        cmd = [venv_python, script_path, '--task-id', str(new_task.id)]
        
        if db_type == 'monthly_labeling':
            if 'workers' in data:
                cmd.extend(['--workers', str(data['workers'])])
        elif db_type == 'generate_drugtox':
            cmd.append('--force')
            if data.get('local', False):
                cmd.append('--local')
        else:
            cmd.append('--force')
        
        # Redirect stdout and stderr to a log file
        log_file = open(log_file_path, 'w')
        process = subprocess.Popen(
            cmd,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            text=True,
            close_fds=True # Ensure file stays open for child but closed in parent after fork
        )
        
        return jsonify({
            'success': True, 
            'task_id': new_task.id,
            'message': f'Started update for {db_type}. Log: {log_file_path}'
        })
    except Exception as e:
        new_task.status = 'failed'
        new_task.error_details = str(e)
        db.session.commit()
        return jsonify({'success': False, 'error': str(e)}), 500

@admin_bp.route('/tasks/<int:task_id>/logs', methods=['GET'])
@login_required
@admin_required
def get_task_logs(task_id):
    from flask import current_app
    log_file_path = os.path.join(current_app.config['DATA_DIR'], 'logs', 'tasks', f'task_{task_id}.log')
    
    if not os.path.exists(log_file_path):
        return jsonify({'success': False, 'error': 'Log file not found'}), 404
        
    try:
        with open(log_file_path, 'r') as f:
            logs = f.read()
        return jsonify({
            'success': True,
            'logs': logs
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@admin_bp.route('/tasks/<int:task_id>', methods=['GET'])
@login_required
@admin_required
def get_task_status(task_id):
    task = SystemTask.query.get_or_404(task_id)
    return jsonify({
        'success': True,
        'task': {
            'id': task.id,
            'type': task.task_type,
            'status': task.status,
            'progress': task.progress,
            'message': task.message,
            'error_details': task.error_details,
            'updated_at': task.updated_at.isoformat() + 'Z' if task.updated_at else None
        }
    })

@admin_bp.route('/tasks/<int:task_id>/cancel', methods=['POST'])
@login_required
@admin_required
def cancel_task(task_id):
    task = SystemTask.query.get_or_404(task_id)
    if task.status in ['pending', 'processing']:
        task.status = 'cancelled'
        task.message = 'Cancelled by user.'
        db.session.commit()
        return jsonify({'success': True})
    return jsonify({'success': False, 'error': 'Task is not running'}), 400

def _parse_token_date_bounds():
    """Parses range/start/end query params into (start_dt, end_dt) naive UTC bounds."""
    from datetime import datetime, timedelta, timezone

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    rng = (request.args.get('range') or '7d').strip().lower()
    if rng == '7d':
        return now - timedelta(days=7), None
    if rng in ('1m', '30d'):
        return now - timedelta(days=30), None
    if rng == 'custom':
        start_s = (request.args.get('start') or '').strip()
        end_s = (request.args.get('end') or '').strip()
        start_dt = datetime.strptime(start_s, '%Y-%m-%d') if start_s else None
        end_dt = (datetime.strptime(end_s, '%Y-%m-%d') + timedelta(days=1)) if end_s else None
        return start_dt, end_dt
    return None, None


def _apply_token_filters(query, model_cls, start_dt, end_dt, model_filter, user_id_filter):
    if start_dt is not None:
        query = query.filter(model_cls.created_at >= start_dt)
    if end_dt is not None:
        query = query.filter(model_cls.created_at < end_dt)
    if model_filter and model_filter != 'all':
        query = query.filter(model_cls.model_name == model_filter)
    if user_id_filter is not None:
        query = query.filter(model_cls.user_id == user_id_filter)
    return query


@admin_bp.route('/token_usage', methods=['GET'])
@login_required
@admin_required
def get_token_usage():
    from datetime import datetime, timedelta, timezone
    from sqlalchemy import case, func
    from database.models import TokenUsage

    try:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        d1 = now - timedelta(days=1)
        d7 = now - timedelta(days=7)
        d30 = now - timedelta(days=30)

        rows = (
            db.session.query(
                User.id.label('user_id'),
                User.username.label('username'),
                func.coalesce(func.sum(TokenUsage.total_tokens), 0).label('total_all_time'),
                func.coalesce(func.sum(case((TokenUsage.created_at >= d1, TokenUsage.total_tokens), else_=0)), 0).label('total_1_day'),
                func.coalesce(func.sum(case((TokenUsage.created_at >= d7, TokenUsage.total_tokens), else_=0)), 0).label('total_7_days'),
                func.coalesce(func.sum(case((TokenUsage.created_at >= d30, TokenUsage.total_tokens), else_=0)), 0).label('total_30_days'),
                func.coalesce(func.sum(TokenUsage.input_tokens), 0).label('input_all_time'),
                func.coalesce(func.sum(TokenUsage.output_tokens), 0).label('output_all_time'),
            )
            .outerjoin(TokenUsage, TokenUsage.user_id == User.id)
            .group_by(User.id, User.username)
            .all()
        )

        display_map = {u.id: u.display_name for u in User.query.all()}
        user_usage = [
            {
                'user_id': r.user_id,
                'username': r.username,
                'display_name': display_map.get(r.user_id, r.username),
                'stats': {
                    'total_all_time': int(r.total_all_time or 0),
                    'total_1_day': int(r.total_1_day or 0),
                    'total_7_days': int(r.total_7_days or 0),
                    'total_30_days': int(r.total_30_days or 0),
                    'input_all_time': int(r.input_all_time or 0),
                    'output_all_time': int(r.output_all_time or 0),
                },
            }
            for r in rows
        ]

        return jsonify({'success': True, 'usage': user_usage})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@admin_bp.route('/token_usage/summary', methods=['GET'])
@login_required
def get_token_usage_summary():
    """Returns SQL-aggregated token KPIs, daily trend, model breakdown, and per-user summary."""
    from flask_login import current_user
    from sqlalchemy import func
    from database.models import TokenUsage

    try:
        start_dt, end_dt = _parse_token_date_bounds()
        model_filter = (request.args.get('model') or 'all').strip()
        req_user_id = request.args.get('user_id', type=int)
        user_id_filter = req_user_id if current_user.is_admin else current_user.id

        # 1. Totals
        totals_q = _apply_token_filters(
            db.session.query(
                func.coalesce(func.sum(TokenUsage.input_tokens), 0).label('input_tokens'),
                func.coalesce(func.sum(TokenUsage.output_tokens), 0).label('output_tokens'),
                func.coalesce(func.sum(TokenUsage.total_tokens), 0).label('total_tokens'),
                func.count(TokenUsage.id).label('request_count'),
            ),
            TokenUsage,
            start_dt,
            end_dt,
            model_filter,
            user_id_filter,
        ).one()

        # 2. Daily trend
        day_col = func.date(TokenUsage.created_at)
        daily_rows = (
            _apply_token_filters(
                db.session.query(
                    day_col.label('day'),
                    func.coalesce(func.sum(TokenUsage.input_tokens), 0).label('input_tokens'),
                    func.coalesce(func.sum(TokenUsage.output_tokens), 0).label('output_tokens'),
                    func.coalesce(func.sum(TokenUsage.total_tokens), 0).label('total_tokens'),
                    func.count(TokenUsage.id).label('requests'),
                ),
                TokenUsage,
                start_dt,
                end_dt,
                model_filter,
                user_id_filter,
            )
            .group_by(day_col)
            .order_by(day_col.asc())
            .all()
        )

        # 3. Model breakdown (filtered by date & user, not model, so model selector stays populated)
        model_rows = (
            _apply_token_filters(
                db.session.query(
                    TokenUsage.model_name.label('model_name'),
                    func.coalesce(func.sum(TokenUsage.input_tokens), 0).label('input_tokens'),
                    func.coalesce(func.sum(TokenUsage.output_tokens), 0).label('output_tokens'),
                    func.coalesce(func.sum(TokenUsage.total_tokens), 0).label('total_tokens'),
                    func.count(TokenUsage.id).label('requests'),
                ),
                TokenUsage,
                start_dt,
                end_dt,
                'all',
                user_id_filter,
            )
            .group_by(TokenUsage.model_name)
            .order_by(func.sum(TokenUsage.total_tokens).desc())
            .all()
        )

        # 4. Per-user summary for Admins (date + model filtered, across all users)
        users_summary = []
        if current_user.is_admin:
            user_rows = (
                _apply_token_filters(
                    db.session.query(
                        User.id.label('user_id'),
                        User.username.label('username'),
                                func.coalesce(func.sum(TokenUsage.input_tokens), 0).label('input_tokens'),
                        func.coalesce(func.sum(TokenUsage.output_tokens), 0).label('output_tokens'),
                        func.coalesce(func.sum(TokenUsage.total_tokens), 0).label('total_tokens'),
                        func.count(TokenUsage.id).label('requests'),
                        func.max(TokenUsage.created_at).label('last_used'),
                    ).join(TokenUsage, TokenUsage.user_id == User.id),
                    TokenUsage,
                    start_dt,
                    end_dt,
                    model_filter,
                    None,
                )
                .group_by(User.id, User.username)
                .order_by(func.sum(TokenUsage.total_tokens).desc())
                .all()
            )
            display_map = {u.id: u.display_name for u in User.query.all()}
            users_summary = [
                {
                    'user_id': r.user_id,
                    'username': r.username,
                    'display_name': display_map.get(r.user_id, r.username),
                    'input_tokens': int(r.input_tokens or 0),
                    'output_tokens': int(r.output_tokens or 0),
                    'total_tokens': int(r.total_tokens or 0),
                    'requests': int(r.requests or 0),
                    'last_used': r.last_used.isoformat() + 'Z' if r.last_used else None,
                }
                for r in user_rows
            ]

        return jsonify({
            'success': True,
            'totals': {
                'input_tokens': int(totals_q.input_tokens or 0),
                'output_tokens': int(totals_q.output_tokens or 0),
                'total_tokens': int(totals_q.total_tokens or 0),
                'request_count': int(totals_q.request_count or 0),
            },
            'daily': [
                {
                    'date': str(r.day),
                    'input_tokens': int(r.input_tokens or 0),
                    'output_tokens': int(r.output_tokens or 0),
                    'total_tokens': int(r.total_tokens or 0),
                    'requests': int(r.requests or 0),
                }
                for r in daily_rows
            ],
            'by_model': [
                {
                    'model_name': r.model_name,
                    'input_tokens': int(r.input_tokens or 0),
                    'output_tokens': int(r.output_tokens or 0),
                    'total_tokens': int(r.total_tokens or 0),
                    'requests': int(r.requests or 0),
                }
                for r in model_rows
            ],
            'available_models': [r.model_name for r in model_rows if r.model_name],
            'users_summary': users_summary,
        })
    except ValueError:
        return jsonify({'success': False, 'error': 'Invalid date format (expected YYYY-MM-DD)'}), 400
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@admin_bp.route('/token_usage/logs', methods=['GET'])
@login_required
def get_token_usage_logs():
    """Returns paginated, on-demand token usage activity logs."""
    from flask_login import current_user
    from database.models import TokenUsage

    try:
        start_dt, end_dt = _parse_token_date_bounds()
        model_filter = (request.args.get('model') or 'all').strip()
        req_user_id = request.args.get('user_id', type=int)
        user_id_filter = req_user_id if current_user.is_admin else current_user.id

        page = max(1, request.args.get('page', default=1, type=int))
        limit = max(1, min(request.args.get('limit', default=25, type=int), 100))

        display_map = {u.id: u.display_name for u in User.query.all()}
        q = (
            db.session.query(TokenUsage, User.username)
            .outerjoin(User, TokenUsage.user_id == User.id)
        )
        q = _apply_token_filters(q, TokenUsage, start_dt, end_dt, model_filter, user_id_filter)
        total = q.count()
        total_pages = max(1, (total + limit - 1) // limit)
        rows = (
            q.order_by(TokenUsage.created_at.desc())
            .offset((page - 1) * limit)
            .limit(limit)
            .all()
        )

        return jsonify({
            'success': True,
            'total': total,
            'page': page,
            'total_pages': total_pages,
            'logs': [
                {
                    'id': tu.id,
                    'user_id': tu.user_id,
                    'username': uname or 'System',
                    'display_name': display_map.get(tu.user_id, uname or 'System'),
                    'model_name': tu.model_name,
                    'input_tokens': int(tu.input_tokens or 0),
                    'output_tokens': int(tu.output_tokens or 0),
                    'total_tokens': int(tu.total_tokens or 0),
                    'created_at': tu.created_at.isoformat() + 'Z' if tu.created_at else None,
                }
                for tu, uname in rows
            ],
        })
    except ValueError:
        return jsonify({'success': False, 'error': 'Invalid date format (expected YYYY-MM-DD)'}), 400
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@admin_bp.route('/token_usage/<int:user_id>', methods=['GET'])
@login_required
def get_user_token_usage_details(user_id):
    from flask_login import current_user
    if not current_user.is_admin and current_user.id != user_id:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 403
    from database.models import TokenUsage
    try:
        usages = TokenUsage.query.filter_by(user_id=user_id).order_by(TokenUsage.created_at.desc()).all()
        return jsonify({
            'success': True,
            'details': [{
                'id': us.id,
                'model_name': us.model_name,
                'input_tokens': us.input_tokens,
                'output_tokens': us.output_tokens,
                'total_tokens': us.total_tokens,
                'created_at': us.created_at.isoformat() + 'Z' if us.created_at else None
            } for us in usages]
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@admin_bp.route('/token_usage/all', methods=['GET'])
@login_required
@admin_required
def get_all_token_usage_details():
    from database.models import TokenUsage, User
    try:
        usages = db.session.query(TokenUsage, User).join(User, TokenUsage.user_id == User.id).order_by(TokenUsage.created_at.desc()).all()
        return jsonify({
            'success': True,
            'details': [{
                'id': us.id,
                'username': user.username,
                'display_name': user.display_name,
                'model_name': us.model_name,
                'input_tokens': us.input_tokens,
                'output_tokens': us.output_tokens,
                'total_tokens': us.total_tokens,
                'created_at': us.created_at.isoformat() + 'Z' if us.created_at else None
            } for us, user in usages]
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


def _get_last_update_date(db_type_keys):
    from database.models import DatabaseUpdateLog, SystemTask
    try:
        log = DatabaseUpdateLog.query.filter(
            DatabaseUpdateLog.db_type.in_(db_type_keys),
            DatabaseUpdateLog.status == 'completed'
        ).order_by(DatabaseUpdateLog.completed_at.desc()).first()
        if log and log.completed_at:
            return log.completed_at.strftime('%Y-%m-%d %H:%M')
    except Exception:
        pass
        
    try:
        task = SystemTask.query.filter(
            SystemTask.task_type.in_(db_type_keys),
            SystemTask.status == 'completed',
            SystemTask.completed_at.isnot(None)
        ).order_by(SystemTask.completed_at.desc()).first()
        if task and task.completed_at:
            return task.completed_at.strftime('%Y-%m-%d %H:%M')
    except Exception:
        pass
        
    return 'N/A'



@admin_bp.route('/db_overview', methods=['GET'])
@login_required
@admin_required
def get_db_overview():
    """Returns consolidated record counts, last update timestamps, linked source files, and recent logs."""
    from flask import current_app
    from sqlalchemy import func, text
    from database.models import (
        DatabaseUpdateLog,
        DrugLabel,
        DrugToxicity,
        MeddraHLGT,
        MeddraHLT,
        MeddraPT,
        MeddraSOC,
        OrangeBook,
        SystemTask,
    )

    def _latest_info(keys):
        log = (
            DatabaseUpdateLog.query.filter(
                DatabaseUpdateLog.db_type.in_(keys),
                DatabaseUpdateLog.status == 'completed',
            )
            .order_by(DatabaseUpdateLog.completed_at.desc())
            .first()
        )
        if log and log.completed_at:
            return log.completed_at.isoformat() + 'Z', log.message
        task = (
            SystemTask.query.filter(
                SystemTask.task_type.in_(keys),
                SystemTask.status == 'completed',
                SystemTask.completed_at.isnot(None),
            )
            .order_by(SystemTask.completed_at.desc())
            .first()
        )
        if task and task.completed_at:
            return task.completed_at.isoformat() + 'Z', task.message
        return None, None

    try:
        data_dir = current_app.config['DATA_DIR']
        files_by_type = {k: file_status(data_dir, k) for k in FILE_TYPES}

        meddra_count = (
            (db.session.query(func.count(MeddraSOC.soc_code)).scalar() or 0)
            + (db.session.query(func.count(MeddraHLGT.hlgt_code)).scalar() or 0)
            + (db.session.query(func.count(MeddraHLT.hlt_code)).scalar() or 0)
            + (db.session.query(func.count(MeddraPT.pt_code)).scalar() or 0)
        )
        try:
            epc_count = db.session.execute(text("SELECT count(*) FROM labeling.substance_indexing")).scalar() or 0
        except Exception:
            epc_count = 0

        drugtox_count = db.session.query(func.count(DrugToxicity.id)).scalar() or 0

        specs = [
            ('monthly_labeling', ['monthly_labeling', 'labeling'], db.session.query(func.count(DrugLabel.spl_id)).scalar() or 0, 'dailymed'),
            ('orangebook', ['orangebook'], db.session.query(func.count(OrangeBook.id)).scalar() or 0, 'orangebook'),
            ('epc', ['epc', 'pharmacologic_class'], epc_count, 'pharmacologic_class'),
            ('drugtox', ['drugtox'], drugtox_count, 'askdrugtox'),
            ('generate_drugtox', ['generate_drugtox'], drugtox_count, None),
            ('meddra', ['meddra'], meddra_count, 'meddra'),
        ]

        datasets = {}
        for key, log_keys, count, file_key in specs:
            last_dt, last_msg = _latest_info(log_keys)
            src = files_by_type.get(file_key) if file_key else None
            datasets[key] = {
                'count': int(count),
                'last_updated': last_dt,
                'last_message': last_msg,
                'source_file': src,
            }

        recent_rows = (
            DatabaseUpdateLog.query.order_by(DatabaseUpdateLog.completed_at.desc())
            .limit(15)
            .all()
        )
        recent_logs = [
            {
                'id': r.id,
                'db_type': r.db_type,
                'status': r.status,
                'message': r.message,
                'completed_at': r.completed_at.isoformat() + 'Z' if r.completed_at else None,
            }
            for r in recent_rows
        ]

        return jsonify({'success': True, 'datasets': datasets, 'recent_logs': recent_logs})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@admin_bp.route('/db_stats/<db_type>', methods=['GET'])
@login_required
@admin_required
def get_db_stats(db_type):
    from database.models import DrugLabel, OrangeBook, DrugToxicity, MeddraSOC, MeddraPT, MeddraHLT, MeddraHLGT
    from sqlalchemy import func, text
    
    try:
        stats = {}
        if db_type in ('labeling', 'monthly_labeling'):
            count = db.session.query(func.count(DrugLabel.spl_id)).scalar()
            latest_date = _get_last_update_date(['monthly_labeling', 'labeling'])
            stats = {'count': count, 'last_date': latest_date}
        elif db_type == 'orangebook':
            count = db.session.query(func.count(OrangeBook.id)).scalar()
            latest_date = _get_last_update_date(['orangebook'])
            if latest_date == 'N/A':
                latest_date = db.session.query(func.max(OrangeBook.approval_date)).scalar() or 'N/A'
            stats = {'count': count, 'last_date': latest_date}
        elif db_type in ('drugtox', 'generate_drugtox'):
            count = db.session.query(func.count(DrugToxicity.id)).scalar()
            latest_date = _get_last_update_date([db_type, 'drugtox', 'generate_drugtox'])
            stats = {'count': count, 'last_date': latest_date}
        elif db_type == 'meddra':
            soc_count = db.session.query(func.count(MeddraSOC.soc_code)).scalar()
            hlgt_count = db.session.query(func.count(MeddraHLGT.hlgt_code)).scalar()
            hlt_count = db.session.query(func.count(MeddraHLT.hlt_code)).scalar()
            pt_count = db.session.query(func.count(MeddraPT.pt_code)).scalar()
            latest_date = _get_last_update_date(['meddra'])
            stats = {
                'soc_count': soc_count,
                'hlgt_count': hlgt_count,
                'hlt_count': hlt_count,
                'pt_count': pt_count,
                'total_count': soc_count + hlgt_count + hlt_count + pt_count,
                'last_date': latest_date
            }
        elif db_type in ('epc', 'pharmacologic_class'):
            count = 0
            try:
                count = db.session.execute(text("SELECT count(*) FROM labeling.substance_indexing")).scalar() or 0
            except Exception:
                pass
            latest_date = _get_last_update_date(['epc', 'pharmacologic_class'])
            stats = {'count': count, 'last_date': latest_date}
        else:
            return jsonify({'success': False, 'error': f'Invalid db_type: {db_type}'}), 400
            
        return jsonify({'success': True, 'stats': stats})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# --- Feature Gates -----------------------------------------------------------
#
# The gates are resolved per request (see dashboard.services.feature_gates), so
# a change here applies to the next request in every process without a restart.

@admin_bp.route('/feature_gates', methods=['GET'])
@login_required
@admin_required
def get_feature_gates():
    from dashboard.services import feature_gates
    return jsonify({
        'success': True,
        'roles': list(ROLES),
        'features': feature_gates.admin_view(),
    })


@admin_bp.route('/feature_gates/<key>', methods=['PUT'])
@login_required
@admin_required
def update_feature_gate(key):
    from dashboard.services import feature_gates

    data = request.get_json() or {}
    if 'min_role' not in data and 'allow_guest' not in data:
        return jsonify({'success': False, 'error': 'Nothing to update'}), 400

    try:
        feature_gates.set_gate(
            key,
            min_role=data.get('min_role'),
            allow_guest=data.get('allow_guest'),
            updated_by_id=current_user.id,
        )
    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 400

    # An admin who locks themselves out of the panel could not undo it, so the
    # gate list is returned with the response and the UI re-renders from it.
    return jsonify({
        'success': True,
        'features': feature_gates.admin_view(),
    })


# --- API Key Management ---

@admin_bp.route('/api_keys', methods=['GET'])
@login_required
@admin_required
def get_all_api_keys():
    """Returns all users with their API key status, creation and last-used timestamps."""
    users = User.query.order_by(User.id.asc()).all()
    keys = []
    for u in users:
        key_val = getattr(u, 'api_key', None)
        masked = f"{key_val[:10]}...{key_val[-4:]}" if key_val and len(key_val) >= 14 else (key_val if key_val else None)
        keys.append({
            'user_id': u.id,
            'username': u.username,
            'display_name': u.display_name,
            'role': u.effective_role,
            'is_active': getattr(u, 'is_active', True),
            'has_api_key': bool(key_val),
            'api_key': key_val,
            'api_key_masked': masked,
            'created_at': u.api_key_created_at.isoformat() if getattr(u, 'api_key_created_at', None) else None,
            'last_used_at': u.api_key_last_used.isoformat() if getattr(u, 'api_key_last_used', None) else None,
        })
    return jsonify({
        'success': True,
        'keys': keys
    })


@admin_bp.route('/api_keys/<int:user_id>/generate', methods=['POST'])
@login_required
@admin_required
def admin_generate_api_key(user_id):
    """Generates / rotates an API key for a specified user."""
    user = User.query.get_or_404(user_id)
    if user.is_guest:
        return jsonify({'success': False, 'error': 'Cannot generate API keys for guest accounts.'}), 400
    
    new_key = user.generate_api_key()
    user.api_key_created_at = utc_now()
    user.api_key_last_used = None
    db.session.commit()
    return jsonify({
        'success': True,
        'api_key': new_key,
        'message': f'API key generated for user {user.display_name}.'
    })


@admin_bp.route('/api_keys/<int:user_id>', methods=['DELETE'])
@login_required
@admin_required
def admin_revoke_api_key(user_id):
    """Revokes the API key for a specified user."""
    user = User.query.get_or_404(user_id)
    user.api_key = None
    user.api_key_created_at = None
    user.api_key_last_used = None
    db.session.commit()
    return jsonify({
        'success': True,
        'message': f'API key revoked for user {user.display_name}.'
    })
