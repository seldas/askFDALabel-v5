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


# Add backend to path

from database import db, User
from dashboard import create_app
from sqlalchemy import text

def debug_admin():
    app = create_app()
    with app.app_context():
        print("=== Debugging Admin Login ===")
        
        # 1. Check if column exists
        try:
            res = db.session.execute(text("SELECT is_admin FROM \"user\" LIMIT 1")).fetchone()
            print(f"Column 'is_admin' exists check: Success")
        except Exception as e:
            print(f"Column 'is_admin' exists check: FAILED - {e}")
            return

        # 2. Check admin user
        admin = User.query.filter(db.func.lower(User.username) == 'admin').first()
        if not admin:
            print("User 'admin' NOT FOUND in database.")
        else:
            print(f"User 'admin' found. ID: {admin.id}, is_admin: {admin.is_admin}")
            
            # 3. Test password check
            password_to_test = "1986414"
            try:
                is_valid = admin.check_password(password_to_test)
                print(f"Password check for '{password_to_test}': {'SUCCESS' if is_valid else 'FAILED'}")
            except Exception as e:
                print(f"Password check error: {e}")

if __name__ == "__main__":
    debug_admin()