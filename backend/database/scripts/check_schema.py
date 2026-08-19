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

load_dotenv()
conn = psycopg2.connect(os.getenv('DATABASE_URL'))
cur = conn.cursor()
cur.execute("SELECT COUNT(*) FROM labeling.sum_spl")
res = cur.fetchone()
if res:
    print(f"Total labels in sum_spl: {res[0]}")
else:
    print("No labels found in labeling.sum_spl.")
conn.close()