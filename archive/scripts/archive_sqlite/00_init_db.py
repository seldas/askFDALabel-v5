import os
import sys
from pathlib import Path

# Add backend to path
root_dir = Path(__file__).resolve().parent.parent.parent
sys.path.append(str(root_dir / 'backend'))

from dashboard import create_app
from database import db

def init_db():
    print("=== Unified Database Initializer ===")
    app = create_app()
    with app.app_context():
        # This will use SQLALCHEMY_DATABASE_URI from config
        print(f"Initializing database at: {app.config['SQLALCHEMY_DATABASE_URI']}")
        
        # Ensure data directory exists
        data_dir = Path(app.config['DATA_DIR'])
        data_dir.mkdir(parents=True, exist_ok=True)
        
        # Create all tables
        db.create_all()
        print("[SUCCESS] All tables created in afd.db")

if __name__ == "__main__":
    init_db()
