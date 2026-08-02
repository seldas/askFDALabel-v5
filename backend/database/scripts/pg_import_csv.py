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

import csv
import argparse
from pg_utils import PGUtils

def import_csv(file_path, table_name, schema='public', delimiter=',', on_conflict=None):
    """Imports a CSV file into a PostgreSQL table."""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            reader = csv.reader(f, delimiter=delimiter)
            columns = next(reader)
            data = [tuple(row) for row in reader]
            
            print(f"Importing {len(data)} rows into {schema}.{table_name}...")
            PGUtils.bulk_insert(table_name, columns, data, schema=schema, on_conflict=on_conflict)
            print("Import successful.")
    except Exception as e:
        print(f"Error during import: {e}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generic CSV to PostgreSQL Importer")
    parser.add_argument("file", help="Path to the CSV file")
    parser.add_argument("table", help="Target table name")
    parser.add_argument("--schema", default="public", help="Target schema (default: public)")
    parser.add_argument("--delimiter", default=",", help="CSV delimiter (default: ,)")
    parser.add_argument("--on-conflict", help="Conflict resolution clause (e.g., 'DO NOTHING')")
    
    args = parser.parse_args()
    import_csv(args.file, args.table, args.schema, args.delimiter, args.on_conflict)