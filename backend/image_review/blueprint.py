"""Independent, gated visual review endpoints with per-account task ownership."""

import io
import json
from uuid import uuid4

from flask import Blueprint, current_app, jsonify, request, send_file
from flask_login import current_user
from werkzeug.exceptions import BadRequest, HTTPException

from database import db
from database.models import SystemTask
from dashboard.routes.guards import feature_before_request
from dashboard.services.task_service import TaskService
from .assets import (FILE_LIMIT, label_inventory, read_local_artwork, normalized_image,
                     prepare_side, save_job, clean_job)
from .review import MODES
from .tasks import execute_review

image_review_bp = Blueprint('image_review', __name__)
image_review_bp.before_request(feature_before_request('tool_image_review'))


@image_review_bp.errorhandler(HTTPException)
def http_error(exc):
    return jsonify(error=exc.description), exc.code


@image_review_bp.get('/labels/<set_id>/images')
def inventory(set_id):
    _, source, items = label_inventory(set_id, request.args.get('spl_id'))
    return jsonify(images=items[0], source=source)


@image_review_bp.get('/labels/<set_id>/images/<asset_id>')
def artwork(set_id, asset_id):
    _, source, items = label_inventory(set_id, request.args.get('spl_id'))
    raw = read_local_artwork(source, items, asset_id)
    image, _ = normalized_image(raw)
    response = send_file(io.BytesIO(image), mimetype='image/png')
    response.headers['Cache-Control'] = 'private, no-store'
    return response


@image_review_bp.post('/reviews')
def start_review():
    if getattr(current_user, 'is_guest', False):
        return jsonify(error='Sign in with a personal account to create a visual review.'), 403
    active = SystemTask.query.filter(SystemTask.user_id == current_user.id, SystemTask.task_type == 'image_review',
                                     SystemTask.status.in_(['pending', 'processing'])).first()
    if active:
        return jsonify(error='A visual review is already running for your account.', task_id=active.id), 409
    if request.content_length and request.content_length > 2 * FILE_LIMIT + 512 * 1024:
        return jsonify(error='Request exceeds the two-image upload limit.'), 413
    mode = request.form.get('mode', 'artwork')
    if mode not in MODES:
        raise BadRequest('Unsupported review mode.')
    try:
        descriptors = [json.loads(request.form.get(side, '{}')) for side in ('left', 'right')]
    except (ValueError, TypeError) as exc:
        raise BadRequest('Invalid image selection.') from exc
    sides = [prepare_side(value, request.files.get(f'{side}_upload')) for side, value in zip(('left', 'right'), descriptors)]
    if mode == 'consistency' and not any(value['text'] for value in sides):
        raise BadRequest('Select at least one corresponding labeling to check image–labeling consistency.')
    job_id = str(uuid4())
    save_job(job_id, sides)
    task = None
    try:
        task = TaskService.create_task('image_review', user_id=current_user.id, message='Preparing visual review...')
        TaskService.start_background_task(current_app._get_current_object(), task.id, execute_review, current_user.id, job_id, mode)
        if task.status == 'failed':
            clean_job(job_id)
            return jsonify(error='The review worker is unavailable. Start Celery and try again.'), 503
        return jsonify(task_id=task.id, status=task.status), 202
    except Exception:
        clean_job(job_id)
        if task is not None:
            db.session.rollback()
            TaskService.update_task(task.id, status='failed', message='Could not dispatch visual review.',
                                    error_details='Review initialization failed before it could be queued.')
        raise


@image_review_bp.get('/reviews/<int:task_id>')
def review_status(task_id):
    task = db.session.get(SystemTask, task_id)
    if not task or task.user_id != current_user.id or task.task_type != 'image_review':
        return jsonify(error='Review not found.'), 404
    return jsonify(task_id=task.id, status=task.status, progress=task.progress, message=task.message,
                   error=task.error_details if task.status == 'failed' else None,
                   result=json.loads(task.result_data) if task.result_data else None)
