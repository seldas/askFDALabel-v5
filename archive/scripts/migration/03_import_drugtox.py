import os
import sys
import argparse
import pandas as pd
from pathlib import Path
from sqlalchemy import text

# Add backend to path
root_dir = Path(__file__).resolve().parent.parent.parent
sys.path.append(str(root_dir / 'backend'))

from database import db, DrugToxicity
from dashboard import create_app

def get_database_url():
    """
    Get appropriate DATABASE_URL based on environment.
    Checks if running in Docker or using Docker Compose.
    """
    # Check if running in Docker by looking for /.dockerenv file
    in_docker = Path('/.dockerenv').exists()
    
    if in_docker:
        # Use DATABASE_URL from environment if available
        return os.getenv('DATABASE_URL', 'postgresql://afd_user:afd_password@db:5432/askfdalabel')
    else:
        # When running outside Docker, use localhost instead of 'db'
        return 'postgresql://afd_user:afd_password@localhost:5432/askfdalabel'

def configure_app(app):
    """Configure the app with the appropriate DATABASE_URL"""
    original_db_url = app.config['SQLALCHEMY_DATABASE_URI']
    new_db_url = get_database_url()
    
    if original_db_url != new_db_url:
        app.config['SQLALCHEMY_DATABASE_URI'] = new_db_url
        db.init_app(app)
        with app.app_context():
            db.engine.dispose()  # Properly close old connections
            
    return app

def import_drugtox():
    parser = argparse.ArgumentParser(description='Import DrugToxicity data into PostgreSQL')
    parser.add_argument('--force', action='store_true', help='Force update by clearing existing table')
    args = parser.parse_args()

    app = create_app()
    app = configure_app(app)
    with app.app_context():
        print("=== DrugTox Data Importer (PostgreSQL Optimized) ===")
        
        # Check if we are actually using Postgres
        engine_name = db.engine.name
        print(f"  [i] Target Database: {engine_name}")
        
        table_name = DrugToxicity.__tablename__
        
        if args.force:
            print(f"  [-] Force update: Dropping and recreating {table_name} table...")
            db.session.execute(text(f"DROP TABLE IF EXISTS {table_name} CASCADE"))
            db.session.commit()
            # Recreate tables based on current models
            db.create_all()
            print(f"  [+] Table recreated.")
        else:
            # Check if data already exists
            try:
                existing_count = db.session.query(DrugToxicity).count()
                if existing_count > 0:
                    print(f"  [i] Table {table_name} already has {existing_count} records. Skipping. (Use --force to update)")
                    return
            except Exception:
                # Table might not exist, db.create_all() will handle it
                db.create_all()

        root_dir = Path(__file__).resolve().parent.parent.parent
        excel_path = root_dir / 'data' / 'downloads' / 'ALT_update_latest.xlsx'
        
        if not excel_path.exists():
            print(f"Critical Error: Excel file not found at {excel_path}")
            return

        print(f"  [+] Reading {excel_path}...")
        try:
            df = pd.read_excel(excel_path)
        except Exception as e:
            print(f"  [!] Error reading Excel file: {e}")
            return

        # Basic Cleaning
        df.columns = [c.replace(' ', '_').replace('/', '_').replace('(', '').replace(')', '').replace('-', '_') for c in df.columns]
        
        if 'SETID' not in df.columns:
            print("  [!] Error: SETID column missing.")
            return

        print("  [+] Calculating historical flags...")
        # Sort to identify the most recent entry for each unique drug-tox pair
        # Higher Effective_Time (if string-comparable) or we assume the order is correct
        df = df.sort_values(
            ['Trade_Name', 'Author_Organization', 'Tox_Type', 'SPL_Effective_Time'], 
            ascending=[True, True, True, False]
        )
        
        df['is_historical'] = df.duplicated(
            subset=['Trade_Name', 'Author_Organization', 'Tox_Type'], 
            keep='first'
        ).astype(int)

        print(f"  [+] Importing {len(df)} records into '{table_name}'...")
        
        objects = []
        batch_size = 1000
        total_count = 0
        
        try:
            for _, row in df.iterrows():
                # Prepare data for bulk insert
                data = {
                    'SETID': str(row['SETID']),
                    'Trade_Name': str(row.get('Trade_Name', '')),
                    'Generic_Proper_Names': str(row.get('Generic_Proper_Names', '')),
                    'Toxicity_Class': str(row.get('Toxicity_Class', '')),
                    'Author_Organization': str(row.get('Author_Organization', '')),
                    'Tox_Type': str(row.get('Tox_Type', '')),
                    'SPL_Effective_Time': str(row.get('SPL_Effective_Time', '')),
                    'Changed': str(row.get('Changed', '')),
                    'is_historical': int(row.get('is_historical', 0)),
                    'Update_Notes': str(row.get('Update_Notes', '')) if pd.notna(row.get('Update_Notes')) else None,
                    'AI_Summary': str(row.get('AI_Summary', '')) if pd.notna(row.get('AI_Summary')) else None,
                    'endpoint': str(row.get('endpoint', '')) if pd.notna(row.get('endpoint')) else None,
                    'Explanations': str(row.get('Explanations', '')) if pd.notna(row.get('Explanations')) else None
                }
                objects.append(data)
                
                if len(objects) >= batch_size:
                    db.session.bulk_insert_mappings(DrugToxicity, objects)
                    db.session.commit()
                    total_count += len(objects)
                    print(f"    - Inserted {total_count} records...")
                    objects = []
            
            if objects:
                db.session.bulk_insert_mappings(DrugToxicity, objects)
                db.session.commit()
                total_count += len(objects)
                
            print(f"\n[!] Success! Total {total_count} records imported.")
            
        except Exception as e:
            print(f"  [!] Error during import: {e}")
            db.session.rollback()

if __name__ == "__main__":
    import_drugtox()
