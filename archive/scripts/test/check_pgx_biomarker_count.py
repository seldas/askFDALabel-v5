import os
import sys
from pathlib import Path

# Add backend to path
root_dir = Path(__file__).resolve().parent.parent.parent
sys.path.append(str(root_dir / 'backend'))

from database import db, PgxBiomarker
from dashboard import create_app

def check_count():
    app = create_app()
    with app.app_context():
        count = PgxBiomarker.query.count()
        print(f"Count in pgx_biomarker: {count}")

if __name__ == "__main__":
    check_count()
