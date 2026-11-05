"""Tracked incremental import of the admin-managed DailyMed monthly archive."""
import argparse
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

backend_dir = Path(__file__).resolve().parent.parent.parent
sys.path.append(str(backend_dir))
from database import db, SystemTask, DatabaseUpdateLog
from dashboard import create_app


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--task-id', type=int)
    parser.add_argument('--workers', type=int, default=4)
    args = parser.parse_args()
    app = create_app()
    with app.app_context():
        task = db.session.get(SystemTask, args.task_id) if args.task_id else None
        try:
            if task:
                task.progress, task.status = 5, 'processing'
                task.message = 'Unpacking managed DailyMed monthly update...'
                db.session.commit()
            root = Path(app.config['DATA_DIR'])
            source_dir = root / 'monthly_updates' / 'DailyMed'
            storage_dir = root / 'spl_storage'
            script = backend_dir / 'database' / 'scripts' / 'db_07_import_labels.py'
            subprocess.run([
                sys.executable, str(script), '--downloads-dir', str(source_dir),
                '--storage-dir', str(storage_dir), '--workers', str(args.workers), '--replace-existing-zips',
            ], cwd=str(backend_dir.parent), check=True)
            now = datetime.now(timezone.utc).replace(tzinfo=None)
            if task:
                task.progress, task.status = 100, 'completed'
                task.message, task.completed_at = 'Monthly DailyMed update complete.', now
                db.session.commit()
            try:
                db.session.add(DatabaseUpdateLog(
                    db_type='monthly_labeling',
                    completed_at=now,
                    status='completed',
                    message='Monthly DailyMed update complete.'
                ))
                db.session.commit()
            except Exception as log_err:
                print(f"[WARN] Failed to write DatabaseUpdateLog: {log_err}")
        except Exception as exc:
            if task:
                task.status, task.error_details = 'failed', str(exc)
                db.session.commit()
            raise


if __name__ == '__main__':
    main()
