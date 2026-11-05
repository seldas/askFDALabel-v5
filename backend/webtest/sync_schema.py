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

def ensure_core_constraints(engine):
    """
    Validates and ensures that referenced core tables (especially public."user")
    have a PRIMARY KEY or UNIQUE constraint on their primary key columns
    BEFORE db.metadata.create_all() attempts to create foreign keys referencing them.
    This prevents PostgreSQL error:
    "there is no unique constraint matching given keys for referenced table 'user'"
    """
    core_tables = [
        ('public', 'user', 'id'),
        ('public', 'project', 'id'),
        ('public', 'examine_prompts', 'id'),
    ]

    try:
        with engine.connect() as conn:
            # 0. Ensure required schema exists
            try:
                conn.execute(text("CREATE SCHEMA IF NOT EXISTS labeling;"))
                conn.commit()
            except Exception as e:
                print(f"  [!] Note creating labeling schema: {e}")
                conn.rollback()

            for schema_name, table_name, pk_col in core_tables:
                # 1. Check if table exists
                check_table = text("""
                    SELECT EXISTS (
                        SELECT 1 FROM information_schema.tables 
                        WHERE table_schema = :schema AND table_name = :table
                    );
                """)
                exists = conn.execute(check_table, {"schema": schema_name, "table": table_name}).scalar()
                if not exists:
                    continue

                # 2. Check if column exists
                check_col = text("""
                    SELECT EXISTS (
                        SELECT 1 FROM information_schema.columns 
                        WHERE table_schema = :schema AND table_name = :table AND column_name = :col
                    );
                """)
                col_exists = conn.execute(check_col, {"schema": schema_name, "table": table_name, "col": pk_col}).scalar()
                if not col_exists:
                    continue

                # 3. Check if a PK or UNIQUE constraint covers pk_col
                check_constraint = text("""
                    SELECT c.conname, c.contype
                    FROM pg_constraint c
                    JOIN pg_class t ON c.conrelid = t.oid
                    JOIN pg_namespace n ON t.relnamespace = n.oid
                    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
                    WHERE n.nspname = :schema
                      AND t.relname = :table
                      AND c.contype IN ('p', 'u')
                      AND a.attname = :col;
                """)
                constraints = conn.execute(check_constraint, {
                    "schema": schema_name, 
                    "table": table_name, 
                    "col": pk_col
                }).fetchall()

                if constraints:
                    continue

                print(f"  [*] Table '{schema_name}.{table_name}' exists but is missing PRIMARY KEY / UNIQUE constraint on '{pk_col}'. Repairing...")

                # Clean up NULLs if any
                null_count = conn.execute(text(f"""
                    SELECT COUNT(*) FROM "{schema_name}"."{table_name}" WHERE "{pk_col}" IS NULL;
                """)).scalar() or 0
                if null_count > 0:
                    print(f"      Repairing {null_count} row(s) with NULL {pk_col} in {schema_name}.{table_name}...")
                    conn.execute(text(f"""
                        WITH max_val AS (
                            SELECT COALESCE(MAX("{pk_col}"), 0) AS m 
                            FROM "{schema_name}"."{table_name}" 
                            WHERE "{pk_col}" IS NOT NULL
                        ),
                        numbered AS (
                            SELECT ctid, ROW_NUMBER() OVER () as rnum 
                            FROM "{schema_name}"."{table_name}" 
                            WHERE "{pk_col}" IS NULL
                        )
                        UPDATE "{schema_name}"."{table_name}" t
                        SET "{pk_col}" = max_val.m + numbered.rnum
                        FROM numbered, max_val
                        WHERE t.ctid = numbered.ctid;
                    """))
                    conn.commit()

                # Clean up duplicates if any
                dup_count = conn.execute(text(f"""
                    SELECT COUNT(*) FROM (
                        SELECT "{pk_col}" FROM "{schema_name}"."{table_name}" 
                        GROUP BY "{pk_col}" HAVING COUNT(*) > 1
                    ) sub;
                """)).scalar() or 0
                if dup_count > 0:
                    print(f"      Repairing duplicate {pk_col} values in {schema_name}.{table_name}...")
                    conn.execute(text(f"""
                        WITH duplicates AS (
                            SELECT ctid, "{pk_col}", ROW_NUMBER() OVER (PARTITION BY "{pk_col}" ORDER BY ctid) as rn
                            FROM "{schema_name}"."{table_name}"
                        ),
                        max_val AS (SELECT COALESCE(MAX("{pk_col}"), 0) AS m FROM "{schema_name}"."{table_name}"),
                        to_update AS (
                            SELECT ctid, ROW_NUMBER() OVER () as offset_val
                            FROM duplicates
                            WHERE rn > 1
                        )
                        UPDATE "{schema_name}"."{table_name}" t
                        SET "{pk_col}" = max_val.m + to_update.offset_val
                        FROM to_update, max_val
                        WHERE t.ctid = to_update.ctid;
                    """))
                    conn.commit()

                # Ensure NOT NULL
                try:
                    conn.execute(text(f'ALTER TABLE "{schema_name}"."{table_name}" ALTER COLUMN "{pk_col}" SET NOT NULL;'))
                    conn.commit()
                except Exception as e:
                    print(f"      [!] Note on setting NOT NULL: {e}")
                    conn.rollback()

                # Check if table already has another primary key
                has_any_pk = conn.execute(text("""
                    SELECT c.conname
                    FROM pg_constraint c
                    JOIN pg_class t ON c.conrelid = t.oid
                    JOIN pg_namespace n ON t.relnamespace = n.oid
                    WHERE n.nspname = :schema
                      AND t.relname = :table
                      AND c.contype = 'p';
                """), {"schema": schema_name, "table": table_name}).scalar()

                try:
                    if not has_any_pk:
                        pk_name = f"{table_name}_pkey"
                        conn.execute(text(f'ALTER TABLE "{schema_name}"."{table_name}" ADD CONSTRAINT "{pk_name}" PRIMARY KEY ("{pk_col}");'))
                        print(f"      [+] Added PRIMARY KEY constraint '{pk_name}' on {schema_name}.{table_name}({pk_col}).")
                    else:
                        uniq_name = f"{table_name}_{pk_col}_key"
                        conn.execute(text(f'ALTER TABLE "{schema_name}"."{table_name}" ADD CONSTRAINT "{uniq_name}" UNIQUE ("{pk_col}");'))
                        print(f"      [+] Added UNIQUE constraint '{uniq_name}' on {schema_name}.{table_name}({pk_col}).")
                    conn.commit()
                except Exception as e:
                    print(f"      [!] Error adding PK/UNIQUE constraint to {schema_name}.{table_name}: {e}")
                    conn.rollback()

                # Sync sequence if exists
                try:
                    seq_res = conn.execute(text(f"""
                        SELECT pg_get_serial_sequence('"{schema_name}"."{table_name}"', '{pk_col}');
                    """)).scalar()
                    if seq_res:
                        conn.execute(text(f"""
                            SELECT setval(:seq, COALESCE((SELECT MAX("{pk_col}") FROM "{schema_name}"."{table_name}"), 0) + 1, false);
                        """), {"seq": seq_res})
                        conn.commit()
                except Exception:
                    pass

    except Exception as e:
        print(f"  [!] Note during constraint validation: {e}")

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
                pg_db = pg_db or 'fdalabel-v3'
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
    
    # 0. Pre-validate constraints on referenced tables (e.g. 'user' primary key)
    print("[0/2] Validating core table constraints (e.g. 'user' primary key)...")
    ensure_core_constraints(engine)

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
