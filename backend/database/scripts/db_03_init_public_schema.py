import os
import sys
from pathlib import Path

# Add backend directory to sys.path
root_dir = Path(__file__).resolve().parent.parent.parent
sys.path.append(str(root_dir))

from database import db
from dashboard import create_app

def init_db():
    app = create_app()
    with app.app_context():
        print("Creating all tables in public schema...")
        db.create_all()
        print("Success!")

if __name__ == "__main__":
    init_db()
