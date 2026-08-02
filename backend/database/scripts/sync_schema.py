# Dynamic path resolution to support both host execution and container environments
from pathlib import Path
import sys
import os
from dotenv import load_dotenv

current_dir = Path(__file__).resolve().parent
repo_root = current_dir
for parent in [current_dir] + list(current_dir.parents):
    if (parent / '.env').exists() or (parent / '.env.template.txt').exists() or (parent / 'app.py').exists():
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

from sqlalchemy import inspect, text, create_engine

# Add root and backend to path

# Load environment variables
load_dotenv(repo_root / '.env')

from database import db

def get_pg_type(column):
    """Maps SQLAlchemy column types to PostgreSQL types."""
    from sqlalchemy.dialects.postgresql import UUID, JSON, JSONB, TIMESTAMP, TEXT, INTEGER, BOOLEAN, VARCHAR, FLOAT
    
    col_type = column.type
    
    if isinstance(col_type, UUID): return "UUID"
    if isinstance(col_type, (JSON, JSONB)): return "JSONB"
    if isinstance(col_type, TIMESTAMP): return "TIMESTAMP"
    if isinstance(col_type, TEXT): return "TEXT"
    if isinstance(col_type, INTEGER): return "INTEGER"
    if isinstance(col_type, BOOLEAN): return "BOOLEAN"
    if isinstance(col_type, VARCHAR): return f"VARCHAR({col_type.length})" if col_type.length else "VARCHAR"
    if isinstance(col_type, FLOAT): return "FLOAT"
    
    # Fallback to string representation
    type_str = str(col_type).upper()
    if 'VARCHAR' in type_str: return type_str
    if 'INTEGER' in type_str: return "INTEGER"
    if 'BOOLEAN' in type_str: return "BOOLEAN"
    if 'TEXT' in type_str: return "TEXT"
    if 'DATETIME' in type_str: return "TIMESTAMP"
    
    return type_str

def sync_schema():
    print("=== Database Schema Sync Tool ===")
    
    db_url = os.getenv('DATABASE_URL')
    if not db_url:
        print("Error: DATABASE_URL not found in .env")
        return

    # Replace 'db' with 'localhost' if running from host (outside Docker container)
    if not os.path.exists('/.dockerenv'):
        if '@db:' in db_url:
            db_url = db_url.replace('@db:', '@localhost:')
        elif 'db:5432' in db_url:
            db_url = db_url.replace('db:5432', 'localhost:5432')
    print("Using DATABASE_URL:", db_url)
            
    engine = create_engine(db_url)
    
    # 1. Create missing tables
    print("[1/2] Creating missing tables...")
    db.metadata.create_all(engine)
    
    # 2. Add missing columns
    print("[2/2] Checking for missing columns...")
    inspector = inspect(engine)

    if True:
        # Iterate over all models
        for full_table_name, table in db.metadata.tables.items():
            # SQLAlchemy internal table name might include schema (e.g., 'labeling.sum_spl')
            # The inspector needs the bare table name and the schema separately.
            if '.' in full_table_name:
                schema_name, table_name = full_table_name.split('.', 1)
            else:
                schema_name = table.schema or 'public'
                table_name = full_table_name

            try:
                existing_columns = {c['name'].lower() for c in inspector.get_columns(table_name, schema=schema_name)}
            except Exception as e:
                print(f"  [!] Could not inspect table {schema_name}.{table_name}: {e}")
                continue

            # Check for columns in model but not in DB
            for column in table.columns:
                col_name = column.name.lower()
                if col_name not in existing_columns:
                    print(f"  [+] Adding column '{column.name}' to table '{schema_name}.{table_name}'...")
                    
                    pg_type = get_pg_type(column)
                    default_val = ""
                    
                    # Basic default handling
                    if column.default is not None:
                        if hasattr(column.default, 'arg'):
                            arg = column.default.arg
                            if isinstance(arg, (int, float, bool)):
                                default_val = f" DEFAULT {str(arg).upper()}"
                            elif isinstance(arg, str) and '(' not in arg:
                                default_val = f" DEFAULT '{arg}'"

                    alter_query = f"ALTER TABLE {schema_name}.{table_name} ADD COLUMN {column.name} {pg_type}{default_val}"
                    
                    try:
                        with engine.connect() as conn:
                            conn.execute(text(alter_query))
                            conn.commit()
                        print(f"      Successfully added {column.name}.")
                    except Exception as e:
                        print(f"      [!] Failed to add {column.name}: {e}")

        print("\n[!] Sync complete.")

if __name__ == "__main__":
    sync_schema()