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

import psycopg2

def fix_favorite_columns():
    
    db_url = os.getenv('DATABASE_URL')
    if not db_url:
        print("DATABASE_URL not found in .env")
        return

    # Replace 'db' with 'localhost' if running from host
    if '@db:' in db_url:
        db_url = db_url.replace('@db:', '@localhost:')

    try:
        conn = psycopg2.connect(db_url)
        conn.autocommit = True
        with conn.cursor() as cur:
            print("Altering columns in 'favorite' table to TEXT...")
            columns = [
                'brand_name', 'generic_name', 'manufacturer_name', 
                'market_category', 'application_number', 'ndc',
                'labeling_type', 'dosage_forms', 'routes', 'epc',
                'fdalabel_link', 'dailymed_spl_link', 'dailymed_pdf_link',
                'product_type', 'label_format'
            ]
            
            for col in columns:
                try:
                    cur.execute(f"ALTER TABLE favorite ALTER COLUMN {col} TYPE TEXT;")
                    print(f"  - Altered favorite.{col} to TEXT")
                except Exception as e:
                    print(f"  - Error altering favorite.{col}: {e}")
            
            print("Altering DrugToxicity columns to TEXT...")
            try:
                cur.execute('ALTER TABLE drug_toxicity ALTER COLUMN "Generic_Proper_Names" TYPE TEXT;')
                print("  - Altered drug_toxicity.\"Generic_Proper_Names\" to TEXT")
            except Exception as e:
                print(f"  - Error altering drug_toxicity.\"Generic_Proper_Names\": {e}")
            
            print("Success!")
        conn.close()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    fix_favorite_columns()