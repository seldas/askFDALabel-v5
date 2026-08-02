# Dynamic path resolution to support both host execution and container environments
from pathlib import Path
import sys
import os
from dotenv import load_dotenv

current_dir = Path(__file__).resolve().parent

# Add paths to sys.path
paths_to_add = []

# 1. Check if we are inside the container with '/app' as the backend root
if os.path.exists('/app/app.py'):
    paths_to_add.append('/app')

# 2. Walk up the directory structure from the script's location
for parent in [current_dir] + list(current_dir.parents):
    # If the parent is the root repository containing 'backend' folder
    if (parent / 'backend').is_dir():
        paths_to_add.append(str(parent / 'backend'))
    # If the parent is the 'backend' folder itself (contains app.py/database)
    if (parent / 'app.py').exists() and (parent / 'database').is_dir():
        paths_to_add.append(str(parent))

# Remove duplicates while preserving order
for path in paths_to_add:
    if path not in sys.path:
        sys.path.append(path)

# Dynamically find the .env file
env_file = None
for path in paths_to_add + [str(current_dir)] + [str(p) for p in current_dir.parents]:
    p = Path(path)
    if (p / '.env').exists():
        env_file = p / '.env'
        break
    elif (p / '.env.template.txt').exists():
        env_file = p / '.env.template.txt'
        break

if env_file:
    load_dotenv(dotenv_path=env_file)
    print(f"Loaded environment from: {env_file}")

from sqlalchemy import inspect, text, create_engine
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
    print("=== Database Schema Sync Tool (Targetable) ===")
    
    db_url = None
    # 1. Check command line arguments
    if len(sys.argv) > 1:
        db_url = sys.argv[1]
        print("Using DATABASE_URL from command line argument.")
    else:
        # 2. Check environment variable
        env_url = os.getenv('DATABASE_URL')
        if not env_url:
            # Fallback to individual PG variables if DATABASE_URL is not set
            pg_user = os.getenv('PG_USERNAME')
            pg_pass = os.getenv('PG_PASSWORD')
            pg_host = os.getenv('PG_HOST')
            pg_port = os.getenv('PG_PORT')
            pg_db = os.getenv('PG_DATABASE')
            if any([pg_user, pg_pass, pg_host, pg_port, pg_db]):
                pg_user = pg_user or 'afd_user'
                pg_pass = pg_pass or 'afd_password'
                pg_host = pg_host or 'db'
                pg_port = pg_port or '5432'
                pg_db = pg_db or 'askfdalabel'
                env_url = f"postgresql://{pg_user}:{pg_pass}@{pg_host}:{pg_port}/{pg_db}"
        
        default_prompt = f" [default: {env_url}]" if env_url else ""
        print("No URL provided as command line argument.")
        try:
            user_input = input(f"Enter target DATABASE_URL{default_prompt}: ").strip()
            if user_input:
                db_url = user_input
            else:
                db_url = env_url
        except (KeyboardInterrupt, EOFError):
            print("\nCancelled.")
            return

    if not db_url:
        print("Error: DATABASE_URL not specified and not found in environment.")
        return

    # Replace 'db' with 'localhost' if running from host (outside Docker container)
    # only if the user is using the default/inferred db container URL format.
    if not os.path.exists('/.dockerenv'):
        if '@db:' in db_url:
            db_url = db_url.replace('@db:', '@localhost:')
            print("Swapped '@db:' for '@localhost:' (host mode detected)")
        elif 'db:5432' in db_url:
            db_url = db_url.replace('db:5432', 'localhost:5432')
            print("Swapped 'db:5432' for 'localhost:5432' (host mode detected)")
            
    print("Connecting to DATABASE_URL:", db_url)
            
    engine = create_engine(db_url)
    
    # 1. Create missing tables
    print("[1/2] Creating missing tables...")
    db.metadata.create_all(engine)
    
    # 2. Add missing columns
    print("[2/2] Checking for missing columns...")
    inspector = inspect(engine)

    # Iterate over all models
    for full_table_name, table in db.metadata.tables.items():
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
