"""Tracked wrapper for the pharmacologic-class indexing importer."""
import subprocess
import sys
from datetime import datetime
from pathlib import Path

backend_dir = Path(__file__).resolve().parent.parent.parent
sys.path.append(str(backend_dir))
from database import db, SystemTask, DatabaseUpdateLog
from dashboard import create_app


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--task-id', type=int)
    parser.add_argument('--force', action='store_true')
    args = parser.parse_args()
    app = create_app()
    with app.app_context():
        task = db.session.get(SystemTask, args.task_id) if args.task_id else None
        try:
            if task:
                task.progress, task.status, task.message = 5, 'processing', 'Preparing pharmacologic class indexing import...'
                db.session.commit()
            script = backend_dir / 'database' / 'scripts' / 'db_05_import_epc_indexing.py'
            result = subprocess.run([sys.executable, str(script)], cwd=str(backend_dir.parent), check=True)
            now = datetime.utcnow()
            if task:
                task.progress, task.status, task.message = 100, 'completed', 'Pharmacologic class indexing import complete.'
                task.completed_at = now
                db.session.commit()
            try:
                db.session.add(DatabaseUpdateLog(
                    db_type='epc',
                    completed_at=now,
                    status='completed',
                    message='Pharmacologic class indexing import complete.'
                ))
                db.session.commit()
            except Exception as log_err:
                print(f"[WARN] Failed to write DatabaseUpdateLog: {log_err}")
            return result.returncode
        except Exception as exc:
            if task:
                task.status, task.error_details = 'failed', str(exc)
                db.session.commit()
            raise


if __name__ == '__main__':
    main()
