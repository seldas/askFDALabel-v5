"""Dependency-free validation shared by RAPID package tools."""
import hashlib
import stat
import zipfile
from pathlib import Path, PureWindowsPath


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def safe_target(root, name):
    # Reject Windows paths even when validating on a Linux target.
    normalized = name.replace('\\', '/')
    if PureWindowsPath(name).drive or normalized.startswith('/') or '..' in normalized.split('/'):
        raise ValueError(f'Unsafe archive path: {name}')
    root = Path(root).resolve()
    target = (root / normalized).resolve()
    try:
        relative = target.relative_to(root)
    except ValueError:
        raise ValueError(f'Archive path escapes destination: {name}') from None
    if relative == Path('.'):
        raise ValueError(f'Archive path escapes destination: {name}')
    return target


def validate_zip(path, target):
    with zipfile.ZipFile(path) as archive:
        for member in archive.infolist():
            safe_target(target, member.filename)
            if stat.S_ISLNK(member.external_attr >> 16):
                raise ValueError(f'Symlink in archive: {member.filename}')
        bad = archive.testzip()
        if bad:
            raise ValueError(f'Corrupt ZIP member: {bad}')
