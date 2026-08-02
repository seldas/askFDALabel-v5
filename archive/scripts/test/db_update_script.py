import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from srcs.extensions import db
from srcs.models import Annotation
from backend.dashboard.app import create_app
from sqlalchemy import text
import sys

app = create_app()

with app.app_context():
    try:
        # Check if column exists
        with db.engine.connect() as conn:
            # Use a safe way to check columns that works on SQLite
            result = conn.execute(text("PRAGMA table_info(annotation)"))
            columns = [row[1] for row in result.fetchall()]
            
            if 'is_public' not in columns:
                print("Adding is_public column to annotation table...")
                conn.execute(text("ALTER TABLE annotation ADD COLUMN is_public BOOLEAN DEFAULT 0"))
                conn.commit()
                print("Column added successfully.")
            else:
                print("Column is_public already exists.")
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)
