# Dynamic path resolution to support both host execution and container environments
from pathlib import Path
import sys
import os

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

try:
    from dotenv import load_dotenv
    load_dotenv(dotenv_path=repo_root / '.env')
except ImportError:
    env_file = repo_root / '.env'
    if env_file.exists():
        with open(env_file, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    k = k.strip()
                    v = v.strip().strip('"').strip("'")
                    if k not in os.environ:
                        os.environ[k] = v

import re
from sqlalchemy import text, create_engine

def update_schema():
    print("=== Updating 'user' table schema ===")
    
    from dashboard.config import Config
    db_url = Config.SQLALCHEMY_DATABASE_URI
    if not db_url:
        print("Error: SQLALCHEMY_DATABASE_URI not found")
        return
        
    engine = create_engine(db_url)
    
    columns_to_add = [
        {"name": "role", "def": "VARCHAR(20) DEFAULT 'user'"},
        {"name": "api_key", "def": "VARCHAR(64)"},
        {"name": "is_active", "def": "BOOLEAN DEFAULT TRUE"},
        {"name": "ai_provider", "def": "VARCHAR(20) DEFAULT 'gemini'"},
        {"name": "custom_gemini_key", "def": "VARCHAR(255)"},
        {"name": "openai_api_key", "def": "VARCHAR(255)"},
        {"name": "openai_base_url", "def": "VARCHAR(255)"},
        {"name": "openai_model_name", "def": "VARCHAR(100)"},
        {"name": "ai_settings", "def": "TEXT"},
        {"name": "created_at", "def": "TIMESTAMP WITHOUT TIME ZONE"},
        {"name": "last_login", "def": "TIMESTAMP WITHOUT TIME ZONE"},
        {"name": "api_key_created_at", "def": "TIMESTAMP WITHOUT TIME ZONE"},
        {"name": "api_key_last_used", "def": "TIMESTAMP WITHOUT TIME ZONE"}
    ]

    try:
        with engine.connect() as conn:
            dialect_name = engine.dialect.name
            print(f"Database dialect: {dialect_name}")
            
            # Ensure username column is standard varchar(100) and lowercased
            if dialect_name == 'postgresql':
                # Check udt_name of username column in current schema
                type_sql = text("""
                    SELECT udt_name 
                    FROM information_schema.columns 
                    WHERE table_name='user' 
                      AND column_name='username' 
                      AND table_schema = current_schema();
                """)
                type_res = conn.execute(type_sql).fetchone()
                if type_res and type_res[0].lower() == 'citext':
                    print("Migrating 'username' column from 'citext' to 'varchar(100)'...")
                    alter_type_sql = text("ALTER TABLE \"user\" ALTER COLUMN username TYPE VARCHAR(100);")
                    conn.execute(alter_type_sql)
                    conn.commit()
                    print("'username' column successfully altered to 'varchar(100)'.")

                conn.execute(text('UPDATE "user" SET username = LOWER(username);'))
                conn.commit()
            
            # Handle additional columns dynamically
            for col in columns_to_add:
                col_name = col["name"]
                col_def = col["def"]
                
                # Check if column exists first
                check_sql = text(f"""
                    SELECT column_name 
                    FROM information_schema.columns 
                    WHERE table_name='user' 
                      AND column_name='{col_name}' 
                      AND table_schema = current_schema();
                """)
                result = conn.execute(check_sql).fetchone()
                
                if not result:
                    print(f"Column '{col_name}' not found. Adding it...")
                    add_sql = text(f"ALTER TABLE \"user\" ADD COLUMN {col_name} {col_def};")
                    conn.execute(add_sql)
                    conn.commit()
                    print(f"Column '{col_name}' successfully added.")
                else:
                    print(f"Column '{col_name}' already exists.")

            # Backfill legacy users with created_at = '2026-01-01 00:00:00' where NULL
            print("Checking for legacy users with NULL created_at...")
            backfill_sql = text("UPDATE \"user\" SET created_at = '2026-01-01 00:00:00' WHERE created_at IS NULL;")
            res = conn.execute(backfill_sql)
            conn.commit()
            if res.rowcount and res.rowcount > 0:
                print(f"Successfully backfilled {res.rowcount} legacy user(s) with created_at = '2026-01-01 00:00:00'.")
            else:
                print("All users already have created_at set.")

            # Backfill legacy active api keys with api_key_created_at = '2026-01-01 00:00:00' where NULL
            print("Checking for existing API keys with NULL api_key_created_at...")
            backfill_keys_sql = text("UPDATE \"user\" SET api_key_created_at = '2026-01-01 00:00:00' WHERE api_key IS NOT NULL AND api_key_created_at IS NULL;")
            res_keys = conn.execute(backfill_keys_sql)
            conn.commit()
            if res_keys.rowcount and res_keys.rowcount > 0:
                print(f"Successfully backfilled {res_keys.rowcount} API key(s) with api_key_created_at = '2026-01-01 00:00:00'.")
            else:
                print("All existing API keys already have api_key_created_at set.")
                    
    except Exception as e:
        print(f"Error updating schema: {e}")

if __name__ == "__main__":
    update_schema()