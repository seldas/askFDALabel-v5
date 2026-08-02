import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from srcs.extensions import db
from srcs.models import ComparisonSummary
from backend.dashboard.app import create_app
from sqlalchemy import inspect
import sys

app = create_app()

with app.app_context():
    try:
        with db.engine.connect() as conn:
            inspector = inspect(conn)
            tables = inspector.get_table_names()
            
            if 'comparison_summary' not in tables:
                print("Creating comparison_summary table...")
                ComparisonSummary.__table__.create(db.engine)
                print("Table comparison_summary created.")
            else:
                print("Table comparison_summary already exists.")
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)
