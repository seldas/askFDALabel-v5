"""Independent, gated visual review endpoints with per-account task ownership."""

import io
import json
from uuid import uuid4

from flask import Blueprint, current_app, jsonify, request, send_file
from flask_login import current_user
from werkzeug.exceptions import BadRequest, HTTPException

from database import db
from database.models import SystemTask, ImageReviewComment, ImageAnalysisCache, utc_now
from dashboard.routes.guards import feature_before_request
from dashboard.services.task_service import TaskService
from .assets import (FILE_LIMIT, label_inventory, read_local_artwork, normalized_image,
                     prepare_side, save_job, clean_job, history_directory, save_history_images, remove_history_images)
from .review import MODES
from .tasks import execute_review, execute_carton_extraction
from .carton import FIELDS, IMAGE_TYPES

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
    active = SystemTask.query.filter(SystemTask.user_id == current_user.id, SystemTask.task_type.in_(['image_review', 'image_review_extract']),
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
    confirmed = None
    if mode == 'confusion':
        confirmed = validate_carton_confirmation(sides)
    job_id = str(uuid4())
    save_job(job_id, sides)
    task = None
    try:
        task = TaskService.create_task('image_review', user_id=current_user.id, message='Preparing visual review...')
        save_history_images(current_user.id, task.id, sides)
        initial = {'mode': mode, 'sources': {name: side['metadata'] for name, side in zip(('left', 'right'), sides)}}
        if mode == 'confusion':
            initial.update(stage='carton_comparison', carton_inputs=confirmed)
        TaskService.update_task(task.id, result_data=initial)
        TaskService.start_background_task(current_app._get_current_object(), task.id, execute_review, current_user.id, job_id, mode, confirmed)
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


@image_review_bp.get('/history')
def review_history():
    if getattr(current_user, 'is_guest', False):
        return jsonify(error='Sign in with a personal account.'), 403
    tasks = SystemTask.query.filter_by(user_id=current_user.id, task_type='image_review').order_by(SystemTask.created_at.desc(), SystemTask.id.desc()).all()
    reviews = []
    for task in tasks:
        try:
            result = json.loads(task.result_data or '{}')
        except (TypeError, ValueError):
            result = {}
        reviews.append({'task_id': task.id, 'status': task.status, 'created_at': task.created_at.isoformat() + 'Z' if task.created_at else None,
                        'mode': result.get('mode'), 'sources': result.get('sources', {}), 'summary': result.get('summary', ''),
                        'cached': result.get('cached', False)})
    return jsonify(reviews=reviews)


@image_review_bp.get('/reviews/<int:task_id>/images/<side>')
def history_image(task_id, side):
    task = db.session.get(SystemTask, task_id)
    if (not task or task.task_type != 'image_review' or task.user_id != current_user.id
            or getattr(current_user, 'is_guest', False) or side not in ('left', 'right')):
        return jsonify(error='Review not found.'), 404
    path = history_directory(current_user.id, task_id) / f'{side}.png'
    if not path.is_file():
        return jsonify(error='Image not available for this review.'), 404
    response = send_file(path, mimetype='image/png')
    response.headers['Cache-Control'] = 'private, no-store'
    return response


@image_review_bp.delete('/reviews/<int:task_id>')
def delete_review(task_id):
    task = db.session.get(SystemTask, task_id)
    if not task or task.task_type != 'image_review' or task.user_id != current_user.id or getattr(current_user, 'is_guest', False):
        return jsonify(error='Review not found.'), 404
    if task.status not in ('completed', 'failed'):
        return jsonify(error='Wait for the review to finish before deleting it.'), 409
    result = json.loads(task.result_data or '{}')
    cache_key = result.get('_cache_key')
    if cache_key:
        ImageAnalysisCache.query.filter_by(cache_key=cache_key).delete()
    # Identification records are retained only when another review still uses them.
    extraction_ids = {v.get('extraction_task_id') for v in (result.get('carton_inputs') or {}).values()
                      if isinstance(v, dict) and isinstance(v.get('extraction_task_id'), int)}
    if extraction_ids:
        others = SystemTask.query.filter(SystemTask.user_id == current_user.id, SystemTask.task_type == 'image_review', SystemTask.id != task_id).all()
        for other in others:
            try:
                other_result = json.loads(other.result_data or '{}')
                referenced = {v.get('extraction_task_id') for v in (other_result.get('carton_inputs') or {}).values() if isinstance(v, dict)}
                extraction_ids.difference_update(referenced)
            except (TypeError, ValueError, AttributeError):
                # Keep records when a malformed historical review cannot be checked.
                extraction_ids.clear()
                break
        if extraction_ids:
            SystemTask.query.filter(SystemTask.id.in_(extraction_ids), SystemTask.user_id == current_user.id,
                                    SystemTask.task_type == 'image_review_extract', SystemTask.status.in_(['completed', 'failed'])).delete(synchronize_session=False)
    remove_history_images(current_user.id, task_id)
    db.session.delete(task)
    db.session.commit()
    return jsonify(success=True)


@image_review_bp.get('/reviews/<int:task_id>')
def review_status(task_id):
    task = db.session.get(SystemTask, task_id)
    if not task or task.task_type not in ('image_review', 'image_review_extract'):
        return jsonify(error='Review not found.'), 404
    if task.user_id != current_user.id or getattr(current_user, 'is_guest', False):
        return jsonify(error='Review not found.'), 404
    return jsonify(task_id=task.id, status=task.status, progress=task.progress, message=task.message,
                   error=task.error_details if task.status == 'failed' else None,
                   result=json.loads(task.result_data) if task.result_data else None)


def validate_carton_confirmation(sides):
    try:
        submitted = json.loads(request.form.get('carton_inputs', '{}'))
    except (ValueError, TypeError) as exc:
        raise BadRequest('Invalid image confirmation.') from exc
    if not isinstance(submitted, dict):
        raise BadRequest('Confirm both images before comparing.')
    confirmed = {}
    for name, image in zip(('left', 'right'), sides):
        entry = submitted.get(name)
        if not isinstance(entry, dict) or type(entry.get('task_id')) is not int:
            raise BadRequest('Identify and confirm both images before comparing.')
        task = db.session.get(SystemTask, entry['task_id'])
        if not task or task.user_id != current_user.id or task.task_type != 'image_review_extract' or task.status != 'completed':
            raise BadRequest('Image identification is unavailable or still running.')
        record = json.loads(task.result_data or '{}').get('cartons', {}).get(name, {})
        if record.get('status') != 'completed' or record.get('source', {}).get('image_hash') != image['metadata']['image_hash']:
            raise BadRequest('An image changed. Identify the replacement image before comparing.')
        extraction = record['extraction']
        image_type = entry.get('image_type', extraction.get('image_type', 'carton'))
        if image_type not in IMAGE_TYPES:
            raise BadRequest('Specify a supported image type for each product.')
        detected_type = extraction.get('image_type', 'carton')
        if detected_type != 'unknown' and image_type != detected_type:
            raise BadRequest('The image type changed. Identify the image again.')
        if extraction['suitability'] == 'unsupported':
            raise BadRequest('Only package cartons and container labels are supported. Replace the unsupported image.')
        if entry.get('acknowledged') is not True:
            raise BadRequest('Confirm the image suitability and review limitations for each image.')
        edits = entry.get('fields')
        if not isinstance(edits, dict) or any(not isinstance(edits.get(key), str) or len(edits[key]) > 1000 for key in FIELDS):
            raise BadRequest('Invalid confirmed packaging fields.')
        fields = {key: {'value': edits[key].strip(),
                        'source': 'user_provided' if edits[key].strip() != extraction['fields'][key]['value'] else 'image_extraction'} for key in FIELDS}
        confirmed[name] = dict(extraction=extraction, confirmed_fields=fields, extraction_task_id=task.id,
                               model=record.get('model'), image_type=image_type, acknowledged=True)
    if confirmed['left']['image_type'] != confirmed['right']['image_type']:
        raise BadRequest('Select the same image type for both products. Cross-type comparison is not supported.')
    return confirmed


@image_review_bp.post('/cartons/extractions')
def start_carton_extraction():
    if getattr(current_user, 'is_guest', False):
        return jsonify(error='Sign in with a personal account to identify packaging images.'), 403
    if request.content_length and request.content_length > 2 * FILE_LIMIT + 512 * 1024:
        return jsonify(error='Request exceeds the two-image upload limit.'), 413
    active = SystemTask.query.filter(SystemTask.user_id == current_user.id,
                                    SystemTask.task_type.in_(['image_review', 'image_review_extract']),
                                    SystemTask.status.in_(['pending', 'processing'])).first()
    if active:
        return jsonify(error='A visual review is already running for your account.'), 409
    names = [side for side in ('left', 'right') if request.form.get(side)]
    if not names:
        raise BadRequest('Select at least one packaging image.')
    try:
        descriptors = [json.loads(request.form[name]) for name in names]
    except (ValueError, TypeError) as exc:
        raise BadRequest('Invalid image selection.') from exc
    sides = [prepare_side(value, request.files.get(f'{name}_upload')) for name, value in zip(names, descriptors)]
    for name, side in zip(names, sides):
        image_type = request.form.get(f'{name}_image_type', 'auto')
        if image_type not in ('auto', *IMAGE_TYPES):
            raise BadRequest('Unsupported image type.')
        side['metadata']['requested_image_type'] = image_type
    job_id = str(uuid4())
    save_job(job_id, sides)
    task = None
    try:
        task = TaskService.create_task('image_review_extract', user_id=current_user.id, message='Image identification queued.')
        TaskService.start_background_task(current_app._get_current_object(), task.id, execute_carton_extraction, current_user.id, job_id, names)
        if task.status == 'failed':
            clean_job(job_id)
            return jsonify(error='The review worker is unavailable. Start Celery and try again.'), 503
        return jsonify(task_id=task.id), 202
    except Exception:
        clean_job(job_id)
        if task is not None:
            db.session.rollback()
            TaskService.update_task(task.id, status='failed', error_details='Could not queue image identification.')
        raise


@image_review_bp.get('/reviews/<int:task_id>/comments')
def get_review_comments(task_id):
    task = db.session.get(SystemTask, task_id)
    if not task or task.task_type != 'image_review' or task.user_id != current_user.id or getattr(current_user, 'is_guest', False):
        return jsonify(error='Review not found.'), 404

    current_uid = current_user.id
    filters = [ImageReviewComment.task_id == task_id, ImageReviewComment.user_id == current_uid]

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
    if not task or task.task_type != 'image_review' or task.user_id != current_user.id or getattr(current_user, 'is_guest', False):
        return jsonify(error='Review not found.'), 404

    data = request.get_json(silent=True) or {}
    fid = finding_id if finding_id is not None else data.get('finding_id')
    if fid is None:
        raise BadRequest('Finding ID is required.')

    decision = data.get('decision', 'unreviewed')
    if decision not in ('unreviewed', 'confirmed', 'dismissed'):
        decision = 'unreviewed'

    comment_text = data.get('comment', '').strip()
    is_public = False
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

