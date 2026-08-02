# Dynamic path resolution to support both host execution and container environments
from pathlib import Path
import sys
import os
from dotenv import load_dotenv

current_dir = Path(__file__).resolve().parent
repo_root = current_dir
for parent in [current_dir] + list(current_dir.parents):
    if (parent / '.env').exists() or (parent / '.env.template.txt').exists():
        repo_root = parent
        break

# Add backend directory to sys.path
if (repo_root / 'backend').exists():
    sys.path.append(str(repo_root / 'backend'))
else:
    sys.path.append(str(repo_root))

# Add current scripts directory for local module imports
sys.path.append(str(current_dir))

if os.path.exists('/data'):
    data_dir = Path('/data')
else:
    data_dir = repo_root / 'data'

load_dotenv(dotenv_path=repo_root / '.env')

from sqlalchemy import text

# Add backend to path

from database import db
from dashboard import create_app

def add_column():
    app = create_app()
    with app.app_context():
        print("=== Adding 'is_admin' column to 'user' table ===")
        try:
            # Check if column exists first (PostgreSQL)
            check_sql = text("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name='user' AND column_name='is_admin';
            """)
            result = db.session.execute(check_sql).fetchone()
            
            if not result:
                print("Column 'is_admin' not found. Adding it...")
                add_sql = text("ALTER TABLE \"user\" ADD COLUMN is_admin BOOLEAN DEFAULT FALSE;")
                db.session.execute(add_sql)
                db.session.commit()
                print("Column 'is_admin' successfully added.")
            else:
                print("Column 'is_admin' already exists.")
                
        except Exception as e:
            db.session.rollback()
            print(f"Error adding column: {e}")

if __name__ == "__main__":
    add_column()