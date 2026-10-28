"""Version-pinned local artwork and bounded, orientation-normalized image inputs."""

import hashlib
import io
import json
import zipfile
from pathlib import Path
from uuid import UUID

from flask import current_app
from PIL import Image, ImageOps
from werkzeug.exceptions import BadRequest, Conflict, NotFound, RequestEntityTooLarge

from dashboard.routes.image_analysis import _media_entries
from dashboard.services.fdalabel_db import FDALabelDBService

FILE_LIMIT = 12 * 1024 * 1024


def label_inventory(set_id, spl_id=None):
    try:
        set_id = str(UUID(set_id))
        if spl_id:
            spl_id = str(UUID(spl_id))
    except (ValueError, TypeError, AttributeError) as exc:
        raise BadRequest('Enter a valid Set-ID and optional SPL-ID.') from exc
    xml, source = FDALabelDBService.resolve_spl_xml(set_id, spl_id=spl_id)
    if not xml:
        raise NotFound('This labeling is unavailable. Select another version or product.')
    if source.get('version_substituted') or (spl_id and source.get('spl_id') != spl_id):
        raise Conflict('The requested label version is unavailable; a substituted version cannot be used for visual review.')
    if source.get('set_id') and source['set_id'].lower() != set_id:
        raise Conflict('The resolved labeling belongs to another Set-ID.')
    return xml, source, _media_entries(xml)


def read_local_artwork(source, inventory, asset_id):
    entries = inventory[1]
    paths = [path for ref, path in entries.items() if hashlib.sha256(f'{ref}:{path}'.encode()).hexdigest()[:24] == asset_id]
    if len(paths) != 1:
        raise NotFound('Select an image belonging to this labeling.')
    media_path = paths[0]
    local_path = source.get('local_path')
    if local_path:
        configured_roots = [Path(current_app.config[key]).resolve() for key in
                            ('SPL_STORAGE_DIR', 'SPL_STORAGE_DIR_ARCHIVED', 'SPL_CACHE_DIR') if current_app.config.get(key)]
        for root in configured_roots:
            archive_path = (root / local_path).resolve()
            if not archive_path.is_relative_to(root) or not archive_path.is_file():
                continue
            if archive_path.suffix.lower() == '.zip':
                try:
                    with zipfile.ZipFile(archive_path) as archive:
                        names = [n for n in archive.namelist() if n.replace('\\', '/').endswith('/' + media_path) or n.replace('\\', '/') == media_path]
                        if len(names) != 1:
                            names = [n for n in archive.namelist() if Path(n.replace('\\', '/')).name.casefold() == Path(media_path).name.casefold()]
                        if len(names) != 1:
                            raise Conflict('Artwork filename is ambiguous in this archive. Upload the exact image to review.')
                        if archive.getinfo(names[0]).file_size > FILE_LIMIT:
                            raise RequestEntityTooLarge('Artwork exceeds 12 MiB.')
                        return archive.read(names[0])
                except zipfile.BadZipFile:
                    continue
            else:
                candidate = (archive_path.parent / media_path).resolve()
                if candidate.is_relative_to(root) and candidate.is_file():
                    if candidate.stat().st_size > FILE_LIMIT:
                        raise RequestEntityTooLarge('Artwork exceeds 12 MiB.')
                    return candidate.read_bytes()

    set_id = source.get('set_id')
    spl_id = source.get('spl_id')
    is_latest = FDALabelDBService.is_latest_spl(set_id, spl_id)
    if not is_latest:
        raise NotFound('Archived labeling image is currently not available in askFDALabel.')

    # For the current version (or set_id query), fallback to DailyMed
    from dashboard.services.external_services import require_service
    require_service('dailymed')
    import requests
    try:
        resp = requests.get(
            'https://dailymed.nlm.nih.gov/dailymed/image.cfm',
            params={'setid': set_id, 'name': media_path},
            timeout=(5, 30),
        )
        if resp.status_code == 200 and resp.content:
            if len(resp.content) > FILE_LIMIT:
                raise RequestEntityTooLarge('Artwork exceeds 12 MiB.')
            return resp.content
    except requests.RequestException:
        pass

    raise NotFound('Artwork image is not available locally or on DailyMed.')


def normalized_image(raw):
    if len(raw) > FILE_LIMIT:
        raise RequestEntityTooLarge('Each image must be at most 12 MiB.')
    try:
        with Image.open(io.BytesIO(raw)) as image:
            if image.width * image.height > 25_000_000:
                raise RequestEntityTooLarge('Image exceeds 25 megapixels.')
            if image.format not in {'PNG', 'JPEG', 'WEBP', 'GIF', 'TIFF'}:
                raise BadRequest('Use PNG, JPEG, WebP, GIF, or TIFF artwork.')
            image = ImageOps.exif_transpose(image).convert('RGBA')
            # Preserve white paper rather than interpreting transparency as black.
            paper = Image.new('RGBA', image.size, 'white')
            paper.alpha_composite(image)
            normalized = paper.convert('RGB')
            size = normalized.size
            normalized.thumbnail((2048, 2048), Image.Resampling.LANCZOS)
            output = io.BytesIO()
            normalized.save(output, format='PNG')
            return output.getvalue(), {'original_width': size[0], 'original_height': size[1],
                                      'width': normalized.width, 'height': normalized.height}
    except (OSError, ValueError, Image.DecompressionBombError) as exc:
        raise BadRequest('The supplied file is not a readable image.') from exc


def extract_reference(xml):
    import defusedxml.ElementTree as ET
    root = ET.fromstring(xml)
    ns = {'v3': 'urn:hl7-org:v3'}
    # Section titles retained for verifiable, contextual evidence.
    parts = []
    for section in root.findall('.//v3:section', ns):
        title = section.find('v3:title', ns)
        text = section.find('v3:text', ns)
        if text is not None:
            parts.append((' '.join(title.itertext()) if title is not None else 'Section') + '\n' + ' '.join(text.itertext()))
    full = '\n\n'.join(parts)
    return full[:90000], len(full) > 90000


def prepare_side(descriptor, upload=None):
    if not isinstance(descriptor, dict):
        raise BadRequest('Invalid image selection.')
    metadata = {'set_id': descriptor.get('set_id') or None, 'spl_id': descriptor.get('spl_id') or None,
                'image_id': descriptor.get('image_id') or None, 'source': 'user-upload',
                'version_verified': False}
    text, source, inventory = '', None, None
    if metadata['set_id']:
        xml, source, inventory = label_inventory(metadata['set_id'], metadata['spl_id'])
        metadata['set_id'] = source.get('set_id') or metadata['set_id'].lower()
        metadata['spl_id'] = source.get('spl_id')
        text, metadata['reference_truncated'] = extract_reference(xml)
    if upload:
        raw = upload.stream.read(FILE_LIMIT + 1)
        metadata['filename'] = Path(upload.filename or 'Uploaded image').name[:150]
        metadata['image_id'] = None
    else:
        if not source or not metadata['image_id']:
            raise BadRequest('Select a stored artwork image or upload an image for each side.')
        raw = read_local_artwork(source, inventory, metadata['image_id'])
        item = next((v for v in inventory[0] if v['id'] == metadata['image_id']), None)
        if not item:
            raise BadRequest('Unsupported artwork selection.')
        metadata.update(filename=item['filename'], category=item['category'], source='local-artwork', version_verified=True)
    image, dimensions = normalized_image(raw)
    metadata.update(dimensions)
    metadata['image_hash'] = hashlib.sha256(image).hexdigest()
    metadata['reference_hash'] = hashlib.sha256(text.encode()).hexdigest()
    return {'metadata': metadata, 'text': text, 'image': image}


def job_root():
    return (Path(current_app.config['UPLOAD_FOLDER']) / 'image-review').resolve()


def job_directory(job_id):
    # Never accept paths from request data or the queue.
    try:
        normalized = str(UUID(job_id))
    except (ValueError, TypeError, AttributeError) as exc:
        raise BadRequest('Invalid review job.') from exc
    return job_root() / normalized


def save_job(job_id, sides):
    directory = job_directory(job_id)
    directory.mkdir(parents=True, exist_ok=False)
    try:
        for side, value in zip(('left', 'right'), sides):
            (directory / f'{side}.png').write_bytes(value['image'])
        (directory / 'references.json').write_text(json.dumps([{k: v for k, v in side.items() if k != 'image'} for side in sides]), encoding='utf-8')
    except Exception:
        clean_job(job_id)
        raise


def clean_job(job_id):
    directory = job_directory(job_id)
    # Only delete the three known files in this generated job directory.
    for filename in ('left.png', 'right.png', 'references.json'):
        (directory / filename).unlink(missing_ok=True)
    if directory.exists():
        directory.rmdir()


def history_directory(user_id, task_id):
    # These IDs are database integers, never paths supplied by a client.
    return (Path(current_app.config['DATA_DIR']) / 'image_review' / str(int(user_id)) / str(int(task_id)))


def save_history_images(user_id, task_id, sides):
    directory = history_directory(user_id, task_id)
    directory.mkdir(parents=True, exist_ok=False)
    try:
        for side, value in zip(('left', 'right'), sides):
            (directory / f'{side}.png').write_bytes(value['image'])
    except Exception:
        remove_history_images(user_id, task_id)
        raise


def remove_history_images(user_id, task_id):
    directory = history_directory(user_id, task_id)
    for side in ('left', 'right'):
        (directory / f'{side}.png').unlink(missing_ok=True)
    if directory.exists():
        directory.rmdir()
