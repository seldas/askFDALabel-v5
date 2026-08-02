import sqlite3
import psycopg2
from psycopg2 import sql
from psycopg2.extras import execute_values
import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env for Postgres credentials
env_path = Path(__file__).resolve().parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

SQLITE_AFD = "data/afd.db"
SQLITE_LABEL = "data/label.db"
POSTGRES_URI = os.getenv("DATABASE_URL")

def get_pg_conn():
    # Extract components from DSN: postgresql://user:pass@localhost:5432/dbname
    # Simplest way is to pass URI directly to psycopg2
    conn = psycopg2.connect(POSTGRES_URI)
    conn.set_client_encoding('UTF8')
    return conn

def migrate_table(sqlite_conn, pg_conn, table_name, target_schema="public"):
    print(f"Migrating {table_name} to {target_schema}...")
    sl_cursor = sqlite_conn.cursor()
    pg_cursor = pg_conn.cursor()

    # 1. Get Table Definition
    sl_cursor.execute(f"PRAGMA table_info(\"{table_name}\")")
    columns = sl_cursor.fetchall()
    
    col_defs = []
    col_names = []
    pks = []
    for col in columns:
        name = col[1]
        ctype = col[2].upper()
        nullable = "NOT NULL" if col[3] else ""
        pk = col[5]
        
        # Type mapping
        pg_type = ctype
        if "INTEGER" in ctype: pg_type = "INTEGER"
        elif "TEXT" in ctype: pg_type = "TEXT"
        elif "VARCHAR" in ctype: pg_type = "VARCHAR"
        elif "DATETIME" in ctype: pg_type = "TIMESTAMP"
        elif "BOOLEAN" in ctype: pg_type = "BOOLEAN"
        elif "FLOAT" in ctype or "REAL" in ctype: pg_type = "DOUBLE PRECISION"
        
        col_defs.append(f"\"{name}\" {pg_type} {nullable}")
        col_names.append(f"\"{name}\"")
        if pk:
            pks.append(f"\"{name}\"")

    # Handle primary keys
    if pks:
        pk_constraint = f", PRIMARY KEY ({', '.join(pks)})"
    else:
        pk_constraint = ""
        
    col_defs_str = ", ".join(col_defs) + pk_constraint
    
    create_sql = f"CREATE TABLE IF NOT EXISTS {target_schema}.\"{table_name}\" ({col_defs_str})"
    pg_cursor.execute(create_sql)

    # 3. Transfer Data
    sl_cursor.execute(f"SELECT * FROM \"{table_name}\"")
    rows = sl_cursor.fetchall()
    
    if rows:
        # Convert boolean fields from SQLite (int) to PostgreSQL (bool)
        bool_cols = [i for i, col in enumerate(columns) if 'BOOLEAN' in col[2].upper()]
        if bool_cols:
            rows = [
                tuple(bool(val) if i in bool_cols else val for i, val in enumerate(row))
                for row in rows
            ]
        
        # Using execute_values for massive performance boost
        placeholders_sql = f"INSERT INTO {target_schema}.\"{table_name}\" ({', '.join(col_names)}) VALUES %s ON CONFLICT DO NOTHING"
        
        # Chunking if rows are very many
        chunk_size = 5000
        for i in range(0, len(rows), chunk_size):
            chunk = rows[i:i + chunk_size]
            execute_values(pg_cursor, placeholders_sql, chunk)
            print(f"  Inserted {min(i + chunk_size, len(rows))}/{len(rows)} rows into {table_name}...")
    
    pg_conn.commit()
    print(f"  Finished {table_name}: {len(rows)} rows.")

def run_migration():
    if not POSTGRES_URI:
        print("Error: DATABASE_URL not found in .env")
        return

    print("--- Starting PostgreSQL Migration ---")
    pg_conn = get_pg_conn()
    pg_cursor = pg_conn.cursor()

    # Enable pgvector and create schemas
    pg_cursor.execute("CREATE EXTENSION IF NOT EXISTS vector")
    pg_cursor.execute("CREATE SCHEMA IF NOT EXISTS labeling")
    pg_conn.commit()

    # 1. Migrate AFD (Identity/User/Projects)
    if os.path.exists(SQLITE_AFD):
        print(f"\nMigrating {SQLITE_AFD} to public schema...")
        sl_afd = sqlite3.connect(SQLITE_AFD)
        cursor = sl_afd.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        tables = [t[0] for t in cursor.fetchall()]
        for table in tables:
            migrate_table(sl_afd, pg_conn, table, "public")
        sl_afd.close()
    else:
        print(f"Skipping {SQLITE_AFD} (not found)")

    # 2. Migrate LABEL (Index)
    if os.path.exists(SQLITE_LABEL):
        print(f"\nMigrating {SQLITE_LABEL} to labeling schema...")
        sl_label = sqlite3.connect(SQLITE_LABEL)
        cursor = sl_label.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'spl_sections_search%'")
        tables = [t[0] for t in cursor.fetchall()]
        for table in tables:
            migrate_table(sl_label, pg_conn, table, "labeling")
        sl_label.close()
    else:
        print(f"Skipping {SQLITE_LABEL} (not found)")

    pg_conn.close()
    print("\n--- Migration Complete ---")

if __name__ == "__main__":
    run_migration()
