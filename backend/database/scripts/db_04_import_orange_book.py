import os
import sys
import argparse
from pathlib import Path
from sqlalchemy import text

# Dynamic path resolution to support both host execution and container environments
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

if os.path.exists('/data'):
    data_dir = Path('/data')
else:
    data_dir = repo_root / 'data'

from database import db, OrangeBook
from dashboard import create_app

def run_import():
    parser = argparse.ArgumentParser(description='Import Orange Book data into PostgreSQL')
    parser.add_argument('--force', action='store_true', help='Force update by clearing existing table')
    args = parser.parse_args()

    app = create_app()
    with app.app_context():
        print("=== Orange Book Data Importer ===")
        
        # Ensure table exists
        db.create_all()
        
        if args.force:
            print("  [-] Clearing orange_book table...")
            db.session.execute(text("TRUNCATE TABLE orange_book RESTART IDENTITY CASCADE"))
            db.session.commit()
        else:
            count = db.session.query(OrangeBook).count()
            if count > 0:
                print(f"  [i] Table already has {count} records. Use --force to re-import.")
                return

        data_file = data_dir / 'downloads' / 'OrangeBook' / 'EOB_Latest' / 'products.txt'
        if not data_file.exists():
            print(f"  [!] Error: Data file not found at {data_file}")
            return

        print(f"  [+] Importing from {data_file}...")
        
        objects = []
        batch_size = 5000
        total_inserted = 0
        
        try:
            with open(data_file, 'r', encoding='utf-8', errors='replace') as f:
                header = f.readline().strip().split('~')
                # Map header to indices
                # Ingredient~DF;Route~Trade_Name~Applicant~Strength~Appl_Type~Appl_No~Product_No~TE_Code~Approval_Date~RLD~RS~Type~Applicant_Full_Name
                
                for line in f:
                    parts = line.strip().split('~')
                    if len(parts) < 14:
                        continue
                        
                    data = {
                        'ingredient': parts[0],
                        'df_route': parts[1],
                        'trade_name': parts[2],
                        'applicant': parts[3],
                        'strength': parts[4],
                        'appl_type': parts[5],
                        'appl_no': parts[6],
                        'product_no': parts[7],
                        'te_code': parts[8],
                        'approval_date': parts[9],
                        'rld': parts[10],
                        'rs': parts[11],
                        'type': parts[12],
                        'applicant_full_name': parts[13]
                    }
                    
                    objects.append(data)
                    
                    if len(objects) >= batch_size:
                        db.session.bulk_insert_mappings(OrangeBook, objects)
                        db.session.commit()
                        total_inserted += len(objects)
                        print(f"    - Inserted {total_inserted} records...")
                        objects = []
            
            if objects:
                db.session.bulk_insert_mappings(OrangeBook, objects)
                db.session.commit()
                total_inserted += len(objects)
                print(f"    - Finished! Total {total_inserted} records.")
                
        except Exception as e:
            print(f"  [!] Error during import: {e}")
            db.session.rollback()

if __name__ == '__main__':
    run_import()
