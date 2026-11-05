#!/usr/bin/env python3
"""Exercise RAPID host tools using only Python 3.6's standard library.

Run with Python 3.6. Docker operations are mocked; all writes use temp folders.
"""
import contextlib
import io
import json
import stat
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import export_rapid_package as exporter
import import_rapid_package as importer
import restore_db
import dump_db
from package_utils import safe_target, sha256, unlink_if_exists, validate_zip


class ImportCompatibility(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / 'release'
        self.source.mkdir()
        self.target = self.root / 'target'
        self.images = []
        for name in ('backend', 'frontend', 'redis', 'nginx'):
            archive = 'image_{}.tar.gz'.format(name)
            (self.source / archive).write_bytes(b'image fixture')
            self.images.append({'tag': 'fdalabel-v3-{}:latest'.format(name),
                                'id': 'sha256:' + name, 'archive': archive})
        with contextlib.redirect_stdout(io.StringIO()):
            exporter.export_mounted_files(self.source)
        with zipfile.ZipFile(self.source / 'data.zip', 'w') as archive:
            archive.writestr('data/payload.txt', 'payload')
            archive.writestr('data/config/env_settings.json', 'must not overwrite')
            archive.writestr('data/nested/.env', 'must not extract')
        self.write_manifest()

    def write_manifest(self):
        manifest = {'format_version': 1, 'release_id': 'compat-fixture',
                    'images': self.images, 'files': {}}
        for path in self.source.iterdir():
            if path.name != 'manifest.json':
                manifest['files'][path.name] = {'size': path.stat().st_size, 'sha256': sha256(path)}
        (self.source / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')

    def invoke(self, *flags):
        arguments = ['import_rapid_package.py', '--source-dir', str(self.source),
                     '--target-dir', str(self.target)] + list(flags)
        with patch.object(sys, 'argv', arguments), contextlib.redirect_stdout(io.StringIO()):
            importer.main()

    def test_verify_without_writes_or_docker(self):
        with patch.object(importer.subprocess, 'run') as run:
            self.invoke('--verify-only', '--include-data')
            run.assert_not_called()
        self.assertFalse(self.target.exists())

    def test_full_import_and_startup(self):
        self.target.mkdir()
        (self.target / '.env').write_text('FDA_SAML_ENTITY_ID=fixture\nFDA_SAML_ACS_URL=https://example.test/acs\n')
        settings = self.target / 'data' / 'config' / 'env_settings.json'
        settings.parent.mkdir(parents=True)
        settings.write_text('keep')
        before = (self.target / '.env').read_bytes()
        real_run = subprocess.run

        def fake_docker(command, **kwargs):
            # Delegate to real Python 3.6 subprocess.run so unsupported options fail.
            if command[1:3] == ['image', 'inspect']:
                image = next(item for item in self.images if item['tag'] == command[3])
                return real_run([sys.executable, '-c', 'print({!r})'.format(image['id'])], **kwargs)
            return real_run([sys.executable, '-c', 'pass'], **kwargs)

        with patch.object(importer.subprocess, 'run', side_effect=fake_docker) as run:
            self.invoke('--include-data')
            loads = [call for call in run.call_args_list if call[0][0][1] == 'load']
            self.assertEqual(len(loads), 4)
        self.assertEqual((self.target / '.env').read_bytes(), before)
        self.assertEqual(settings.read_text(), 'keep')
        self.assertEqual((self.target / 'data' / 'payload.txt').read_text(), 'payload')
        self.assertFalse((self.target / 'data' / 'nested' / '.env').exists())
        # Execute the extracted startup script using this same Python interpreter.
        result = real_run([sys.executable, str(self.target / 'start_server.py'),
                           '--runtime', 'docker', '--rapid', '--dry-run'],
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('fdalabel-v3-backend:latest', (self.target / 'docker-compose.yml').read_text())

    def test_corrupt_release_stops_before_docker(self):
        (self.source / 'image_backend.tar.gz').write_bytes(b'broken')
        with patch.object(importer.subprocess, 'run') as run, contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                self.invoke()
            run.assert_not_called()
        self.assertFalse(self.target.exists())

    def test_skip_images(self):
        with patch.object(importer.subprocess, 'run') as run:
            self.invoke('--skip-images')
            run.assert_not_called()
        self.assertTrue((self.target / 'start_server.py').is_file())

    def test_paths_and_symlinks(self):
        for name in ('../escape', '..\\escape', '/outside', 'C:\\outside', '.'):
            with self.assertRaises(ValueError):
                safe_target(self.target, name)
        outside = self.root / 'outside'
        outside.mkdir()
        self.target.mkdir()
        (self.target / 'link').symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ValueError):
            safe_target(self.target, 'link/file')
        archive_path = self.root / 'unsafe.zip'
        with zipfile.ZipFile(archive_path, 'w') as archive:
            member = zipfile.ZipInfo('symlink')
            member.external_attr = (stat.S_IFLNK | 0o777) << 16
            archive.writestr(member, '../outside')
        with self.assertRaises(ValueError):
            validate_zip(archive_path, self.target)

    def test_cleanup(self):
        path = self.root / 'cleanup'
        path.touch()
        unlink_if_exists(path)
        unlink_if_exists(path)
        self.assertFalse(path.exists())

    def test_database_env_parsers(self):
        path = self.root / 'database.env'
        path.write_text('PG_HOST=remote\nDATABASE_URL=postgresql://user:pass@${PG_HOST}/db\n')
        for module in (restore_db, dump_db):
            self.assertEqual(module.load_env(path)['DATABASE_URL'], 'postgresql://user:pass@remote/db')

    def test_permission_probe_nonroot(self):
        self.target.mkdir()
        with patch.object(importer.os, 'getuid', return_value=1000), patch.object(importer.os, 'getgid', return_value=1000):
            importer.fix_directory_ownership(self.target)
        self.assertEqual(list(self.target.iterdir()), [])


if __name__ == '__main__':
    print('Runtime: ' + sys.version)
    unittest.main()
