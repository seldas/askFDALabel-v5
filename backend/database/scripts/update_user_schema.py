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

import os, re
from sqlalchemy import text, create_engine

# Add backend to path

# Load environment variables
load_dotenv(repo_root / '.env')

def update_schema():
    print("=== Updating 'user' table schema ===")
    
    from dashboard.config import Config
    db_url = Config.SQLALCHEMY_DATABASE_URI
    if not db_url:
        print("Error: SQLALCHEMY_DATABASE_URI not found")
        return
        
    engine = create_engine(db_url)
    
    columns_to_add = [
        {"name": "is_active", "def": "BOOLEAN DEFAULT TRUE"},
        {"name": "ai_provider", "def": "VARCHAR(20) DEFAULT 'gemini'"},
        {"name": "custom_gemini_key", "def": "VARCHAR(255)"},
        {"name": "openai_api_key", "def": "VARCHAR(255)"},
        {"name": "openai_base_url", "def": "VARCHAR(255)"},
        {"name": "openai_model_name", "def": "VARCHAR(100)"},
        {"name": "ai_settings", "def": "TEXT"}
    ]

    try:
        with engine.connect() as conn:
            dialect_name = engine.dialect.name
            print(f"Database dialect: {dialect_name}")
            
            # PostgreSQL-specific case-insensitive usernames upgrade
            if dialect_name == 'postgresql':
                print("PostgreSQL detected. Ensuring 'citext' extension exists...")
                conn.execute(text("CREATE EXTENSION IF NOT EXISTS citext;"))
                conn.commit()
                
                # Check udt_name of username column in current schema
                type_sql = text("""
                    SELECT udt_name 
                    FROM information_schema.columns 
                    WHERE table_name='user' 
                      AND column_name='username' 
                      AND table_schema = current_schema();
                """)
                type_res = conn.execute(type_sql).fetchone()
                if type_res and type_res[0].lower() != 'citext':
                    print("Updating 'username' column to 'citext' type for case-insensitivity...")
                    alter_type_sql = text("ALTER TABLE \"user\" ALTER COLUMN username TYPE citext;")
                    conn.execute(alter_type_sql)
                    conn.commit()
                    print("'username' column successfully altered to 'citext'.")
                else:
                    print("'username' column is already 'citext' or column not found.")
            
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
                    
    except Exception as e:
        print(f"Error updating schema: {e}")

if __name__ == "__main__":
    update_schema()