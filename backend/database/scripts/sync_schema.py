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
            # 0. Ensure required extension and schema exist
            try:
                conn.execute(text("CREATE EXTENSION IF NOT EXISTS citext;"))
                conn.execute(text("CREATE SCHEMA IF NOT EXISTS labeling;"))
                conn.commit()
            except Exception as e:
                print(f"  [!] Note creating citext extension or labeling schema: {e}")
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
    
    # 0. Pre-validate constraints on referenced tables (e.g. 'user' primary key)
    print("[0/2] Validating core table constraints (e.g. 'user' primary key)...")
    ensure_core_constraints(engine)

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