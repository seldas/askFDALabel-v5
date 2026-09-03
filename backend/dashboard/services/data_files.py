"""Admin-managed source files for local database updates.

Only the allow-listed file types below can be written through the web UI.  The
incoming file name is never used as a server path; each type has one canonical
name and the previous canonical file is retained under ``archive/``.
"""
from __future__ import annotations

import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path


FILE_TYPES = {
    'dailymed': {
        'label': 'DailyMed monthly update', 'filename': 'dailymed_monthly_update.zip',
        'relative_dir': 'monthly_updates/DailyMed', 'extensions': {'.zip'}, 'update_type': 'monthly_labeling',
    },
    'pharmacologic_class': {
        'label': 'Pharmacologic class indexing', 'filename': 'pharmacologic_class_indexing_spl_files.zip',
        'relative_dir': 'monthly_updates/pharmacologic_class_indexing_spl_files', 'extensions': {'.zip'}, 'update_type': 'epc',
    },
    'meddra': {
        'label': 'MedDRA', 'filename': 'meddra.zip', 'relative_dir': 'monthly_updates/MedDRA',
        'extensions': {'.zip'}, 'update_type': 'meddra',
    },
    'orangebook': {
        'label': 'Orange Book', 'filename': 'EOBZIP.zip', 'relative_dir': 'monthly_updates/OrangeBook',
        'extensions': {'.zip'}, 'update_type': 'orangebook',
    },
    'askdrugtox': {
        'label': 'AskDrugTox update', 'filename': 'askdrugtox_update.xlsx', 'relative_dir': 'monthly_updates',
        'extensions': {'.xlsx'}, 'update_type': 'drugtox',
    },
}


def spec(file_type: str) -> dict:
    if file_type not in FILE_TYPES:
        raise ValueError('Unsupported data file type')
    return FILE_TYPES[file_type]


def target_path(data_dir: str | Path, file_type: str) -> Path:
    item = spec(file_type)
    return Path(data_dir) / item['relative_dir'] / item['filename']


def file_status(data_dir: str | Path, file_type: str) -> dict:
    path = target_path(data_dir, file_type)
    exists = path.is_file()
    modified = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc) if exists else None
    age_days = (datetime.now(timezone.utc) - modified).days if modified else None
    return {
        'type': file_type, 'label': spec(file_type)['label'], 'filename': spec(file_type)['filename'],
        'exists': exists, 'size': path.stat().st_size if exists else 0,
        'updated_at': modified.isoformat() if modified else None,
        'age_days': age_days, 'stale': bool(age_days is not None and age_days > 31),
    }


def archive_and_replace(data_dir: str | Path, file_type: str, completed_part: Path) -> Path:
    target = target_path(data_dir, file_type)
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        archive = target.parent / 'archive'
        archive.mkdir(exist_ok=True)
        stamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        shutil.move(str(target), str(archive / f'{target.stem}_{stamp}{target.suffix}'))
    completed_part.replace(target)
    return target


def _safe_extract(source: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(source) as archive:
        base = destination.resolve()
        for member in archive.infolist():
            out = (destination / member.filename).resolve()
            if not out.is_relative_to(base):
                raise ValueError('Archive contains an unsafe path')
        archive.extractall(destination)


def prepare_for_update(data_dir: str | Path, file_type: str) -> None:
    """Materialise an uploaded archive at the paths used by existing importers."""
    root = Path(data_dir)
    source = target_path(root, file_type)
    if not source.exists():
        raise FileNotFoundError(f'Missing uploaded file: {source.name}')
    if file_type == 'orangebook':
        _safe_extract(source, root / 'monthly_updates' / 'OrangeBook' / 'EOB_Latest')
    elif file_type == 'meddra':
        _safe_extract(source, root / 'monthly_updates' / 'MedDRA' / 'MedDRA_latest')
    elif file_type == 'pharmacologic_class':
        _safe_extract(source, root / 'monthly_updates' / 'pharmacologic_class_indexing_spl_files')
