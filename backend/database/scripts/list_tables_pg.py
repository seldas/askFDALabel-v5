# Dynamic path resolution to support both host execution and container environments
from pathlib import Path
import sys
import os
from dotenv import load_dotenv

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

# Add current scripts directory for local module imports
sys.path.append(str(current_dir))

if os.path.exists('/data'):
    data_dir = Path('/data')
else:
    data_dir = repo_root / 'data'

load_dotenv(dotenv_path=repo_root / '.env')

from pg_utils import PGUtils
from psycopg2 import sql

def list_tables():
    conn = PGUtils.get_connection()
    try:
        with conn.cursor() as cur:
            # 1. List Schemas
            cur.execute("SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema', 'pg_catalog');")
            schemas = [r['schema_name'] for r in cur.fetchall()]
            
            print("=== PostgreSQL Schemas and Tables ===")
            for schema in schemas:
                print(f"\nSchema: {schema}")
                cur.execute(
                    sql.SQL("SELECT table_name FROM information_schema.tables WHERE table_schema = {} AND table_type = 'BASE TABLE' ORDER BY table_name;")
                    .format(sql.Literal(schema))
                )
                tables = [r['table_name'] for r in cur.fetchall()]
                if not tables:
                    print("  (No tables found)")
                for table in tables:
                    cur.execute(
                        sql.SQL("SELECT COUNT(*) FROM {schema}.{table};")
                        .format(schema=sql.Identifier(schema), table=sql.Identifier(table))
                    )
                    count = cur.fetchone()['count']
                    print(f"  - {table} ({count} rows)")
                    
    finally:
        conn.close()

if __name__ == "__main__":
    list_tables()