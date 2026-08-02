import sys
from pathlib import Path

# Dynamic path resolution to support both host execution and container environments
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

from database import db, User
from dashboard import create_app

def create_admin():
    app = create_app()
    with app.app_context():
        print("=== Admin User Creator ===")
        
        username = "admin"
        password = "1986414"
        
        # Check if user already exists
        user = User.query.filter_by(username=username).first()
        
        if user:
            print(f"User '{username}' already exists. Updating to admin and resetting password...")
            user.set_password(password)
            user.is_admin = True
        else:
            print(f"Creating new admin user: {username}...")
            user = User(username=username, is_admin=True)
            user.set_password(password)
            db.session.add(user)
        
        try:
            db.session.commit()
            print(f"Successfully created/updated admin user '{username}'.")
        except Exception as e:
            db.session.rollback()
            print(f"Error creating admin user: {e}")

if __name__ == "__main__":
    create_admin()
