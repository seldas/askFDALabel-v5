"""Independent, gated visual review endpoints with per-account task ownership."""

import io
import json
from uuid import uuid4

from flask import Blueprint, current_app, jsonify, request, send_file
from flask_login import current_user
from werkzeug.exceptions import BadRequest, HTTPException

from database import db
from database.models import SystemTask, ImageReviewComment, utc_now
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
    mode = request.form.get('mode', 'consistency')
    if mode not in MODES:
        raise BadRequest('Unsupported review mode.')
    if mode == 'consistency':
        descriptor_raw = request.form.get('left') or request.form.get('single')
        if not descriptor_raw:
            raise BadRequest('Invalid image selection.')
        try:
            descriptor = json.loads(descriptor_raw)
        except (ValueError, TypeError) as exc:
            raise BadRequest('Invalid image selection.') from exc
        upload = request.files.get('left_upload') or request.files.get('single_upload')
        side = prepare_side(descriptor, upload)
        if not side.get('text'):
            raise BadRequest('Select a corresponding drug labeling to check image–labeling consistency.')
        sides = [side]
    else:
        try:
            descriptors = [json.loads(request.form.get(side, '{}')) for side in ('left', 'right')]
        except (ValueError, TypeError) as exc:
            raise BadRequest('Invalid image selection.') from exc
        sides = [prepare_side(value, request.files.get(f'{side}_upload')) for side, value in zip(('left', 'right'), descriptors)]
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
    if not task or task.task_type != 'image_review':
        return jsonify(error='Review not found.'), 404
    if task.user_id != current_user.id and task.status != 'completed':
        return jsonify(error='Review not found.'), 404
    return jsonify(task_id=task.id, status=task.status, progress=task.progress, message=task.message,
                   error=task.error_details if task.status == 'failed' else None,
                   result=json.loads(task.result_data) if task.result_data else None)


@image_review_bp.get('/reviews/<int:task_id>/comments')
def get_review_comments(task_id):
    task = db.session.get(SystemTask, task_id)
    if not task or task.task_type != 'image_review':
        return jsonify(error='Review not found.'), 404

    is_guest = getattr(current_user, 'is_guest', False)
    current_uid = None if is_guest else getattr(current_user, 'id', None)

    filters = [ImageReviewComment.task_id == task_id]
    if current_uid:
        filters.append(db.or_(ImageReviewComment.is_public.is_(True), ImageReviewComment.user_id == current_uid))
    else:
        filters.append(ImageReviewComment.is_public.is_(True))

    comments = ImageReviewComment.query.filter(*filters).order_by(
        ImageReviewComment.finding_id.asc(),
        ImageReviewComment.updated_at.desc()
    ).all()

    return jsonify(comments=[c.to_dict(current_uid) for c in comments])


@image_review_bp.put('/reviews/<int:task_id>/comments/<int:finding_id>')
@image_review_bp.post('/reviews/<int:task_id>/comments')
def save_review_comment(task_id, finding_id=None):
    if getattr(current_user, 'is_guest', False):
        return jsonify(error='Sign in to save personal comments and decisions.'), 403
    if not getattr(current_user, 'can_comment', True):
        return jsonify(error='Commenting and clinical justifications have been disabled for your account by an administrator.'), 403
    task = db.session.get(SystemTask, task_id)
    if not task or task.task_type != 'image_review':
        return jsonify(error='Review not found.'), 404

    data = request.get_json(silent=True) or {}
    fid = finding_id if finding_id is not None else data.get('finding_id')
    if fid is None:
        raise BadRequest('Finding ID is required.')

    decision = data.get('decision', 'unreviewed')
    if decision not in ('unreviewed', 'confirmed', 'dismissed'):
        decision = 'unreviewed'

    comment_text = data.get('comment', '').strip()
    is_public = bool(data.get('is_public', False))
    regions = data.get('regions')
    regions_str = json.dumps(regions) if regions else None
    set_id = data.get('set_id') or None

    record = ImageReviewComment.query.filter_by(
        task_id=task_id,
        finding_id=fid,
        user_id=current_user.id
    ).first()

    if record:
        record.decision = decision
        record.comment = comment_text
        record.is_public = is_public
        if set_id:
            record.set_id = set_id
        if regions is not None:
            record.regions = regions_str
        record.updated_at = utc_now()
    else:
        record = ImageReviewComment(
            task_id=task_id,
            finding_id=fid,
            user_id=current_user.id,
            set_id=set_id,
            decision=decision,
            comment=comment_text,
            is_public=is_public,
            regions=regions_str
        )
        db.session.add(record)

    db.session.commit()
    return jsonify(comment=record.to_dict(current_user.id))


@image_review_bp.delete('/reviews/<int:task_id>/comments/<int:finding_id>')
def delete_review_comment(task_id, finding_id):
    if getattr(current_user, 'is_guest', False):
        return jsonify(error='Sign in with a personal account.'), 403
    record = ImageReviewComment.query.filter_by(
        task_id=task_id,
        finding_id=finding_id,
        user_id=current_user.id
    ).first()
    if record:
        db.session.delete(record)
        db.session.commit()
    return jsonify(success=True)

