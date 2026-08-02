import os
import sys
import argparse
from pathlib import Path
from sqlalchemy import text

# Add backend to path
root_dir = Path(__file__).resolve().parent.parent.parent
sys.path.append(str(root_dir / 'backend'))

from database import (
    db, MeddraSOC, MeddraHLGT, MeddraHLT, MeddraPT, MeddraLLT, 
    MeddraMDHIER, MeddraSMQList, MeddraSMQContent
)
from dashboard import create_app

def parse_int(value):
    if not value or value.strip() == '':
        return None
    try:
        return int(value)
    except ValueError:
        return None

def process_file(file_name, model_class, field_mapping, data_dir, batch_size=10000):
    file_path = os.path.join(data_dir, file_name)
    if not os.path.exists(file_path):
        print(f"  [!] Skipping {file_name}: File not found in {data_dir}")
        return

    table_name = model_class.__tablename__
    
    # Check if data already exists
    try:
        existing_count = db.session.query(model_class).count()
        if existing_count > 0:
            print(f"  [i] Table {table_name} already has {existing_count} records. Skipping. (Use --force to update)")
            return
    except Exception:
        # Table might not exist, db.create_all() at start will handle it
        pass

    print(f"  [+] Importing {file_name} into {table_name}...")
    
    objects = []
    count = 0
    total_count = 0
    
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            for line in f:
                # MedDRA files end with a trailing $ sometimes
                parts = line.strip().split('$')
                
                data = {}
                for field, index in field_mapping.items():
                    if index < len(parts):
                        val = parts[index]
                        col = getattr(model_class, field)
                        # Check column type for integer parsing
                        if str(col.type).upper().startswith('INT'):
                            data[field] = parse_int(val)
                        else:
                            data[field] = val if val != '' else None
                
                objects.append(data)
                count += 1
                
                if count >= batch_size:
                    db.session.bulk_insert_mappings(model_class, objects)
                    db.session.commit()
                    total_count += count
                    print(f"    - Inserted {total_count} records...")
                    objects = []
                    count = 0
            
            if objects:
                db.session.bulk_insert_mappings(model_class, objects)
                db.session.commit()
                total_count += count
                print(f"    - Finished! Total {total_count} records.")
                
    except Exception as e:
        print(f"  [!] Error processing {file_name}: {e}")
        db.session.rollback()

def run_import():
    parser = argparse.ArgumentParser(description='Import MedDRA data into PostgreSQL')
    parser.add_argument('--force', action='store_true', help='Force update by clearing existing tables')
    args = parser.parse_args()

    app = create_app()
    with app.app_context():
        print("=== MedDRA Data Importer (PostgreSQL Optimized) ===")
        
        # Check if we are actually using Postgres
        engine_name = db.engine.name
        print(f"  [i] Target Database: {engine_name}")
        
        if args.force:
            print(f"  [-] Force update: Dropping and recreating MedDRA tables...")
            # Get table names in dependency order for dropping
            tables = [
                'meddra_smq_content', 'meddra_smq_list',
                'meddra_mdhier', 'meddra_llt', 'meddra_pt', 
                'meddra_hlt', 'meddra_hlgt', 'meddra_soc'
            ]
            for table in tables:
                db.session.execute(text(f"DROP TABLE IF EXISTS {table} CASCADE"))
            db.session.commit()
            # Recreate tables based on current models
            db.create_all()
            print(f"  [+] Tables recreated.")

        root_dir = Path(__file__).resolve().parent.parent.parent
        data_dir = root_dir / 'data' / 'downloads' / 'MedDRA' / 'MedDRA_latest' / 'MedAscii'
        
        if not data_dir.exists():
            print(f"Critical Error: MedDRA data directory not found at {data_dir}")
            return

        # Import order matters due to foreign keys
        
        # 1. SOC
        process_file('soc.asc', MeddraSOC, {
            'soc_code': 0, 'soc_name': 1, 'soc_abbrev': 2, 'soc_whoart_code': 3,
            'soc_harts_code': 4, 'soc_costart_code': 5, 'soc_icd9_code': 6,
            'soc_icd9cm_code': 7, 'soc_icd10_code': 8, 'soc_currency': 9
        }, str(data_dir))

        # 2. HLGT
        process_file('hlgt.asc', MeddraHLGT, {
            'hlgt_code': 0, 'hlgt_name': 1, 'hlgt_whoart_code': 2, 'hlgt_harts_code': 3,
            'hlgt_costart_code': 4, 'hlgt_icd9_code': 5, 'hlgt_icd9cm_code': 6,
            'hlgt_icd10_code': 7, 'hlgt_currency': 8
        }, str(data_dir))

        # 3. HLT
        process_file('hlt.asc', MeddraHLT, {
            'hlt_code': 0, 'hlt_name': 1, 'hlt_whoart_code': 2, 'hlt_harts_code': 3,
            'hlt_costart_code': 4, 'hlt_icd9_code': 5, 'hlt_icd9cm_code': 6,
            'hlt_icd10_code': 7, 'hlt_currency': 8
        }, str(data_dir))

        # 4. PT
        process_file('pt.asc', MeddraPT, {
            'pt_code': 0, 'pt_name': 1, 'null_field': 2, 'pt_soc_code': 3,
            'pt_whoart_code': 4, 'pt_harts_code': 5, 'pt_costart_code': 6,
            'pt_icd9_code': 7, 'pt_icd9cm_code': 8, 'pt_icd10_code': 9, 'pt_currency': 10
        }, str(data_dir))

        # 5. LLT
        process_file('llt.asc', MeddraLLT, {
            'llt_code': 0, 'llt_name': 1, 'pt_code': 2, 'llt_whoart_code': 3,
            'llt_harts_code': 4, 'llt_costart_code': 5, 'llt_icd9_code': 6,
            'llt_icd9cm_code': 7, 'llt_icd10_code': 8, 'llt_currency': 9
        }, str(data_dir))

        # 6. MDHIER
        process_file('mdhier.asc', MeddraMDHIER, {
            'pt_code': 0, 'hlt_code': 1, 'hlgt_code': 2, 'soc_code': 3,
            'pt_name': 4, 'hlt_name': 5, 'hlgt_name': 6, 'soc_name': 7,
            'soc_abbrev': 8, 'null_field': 9, 'pt_soc_code': 10, 'primary_soc_fg': 11
        }, str(data_dir))

        # 7. SMQ List
        process_file('smq_list.asc', MeddraSMQList, {
            'smq_code': 0, 'smq_name': 1, 'smq_level': 2, 'smq_description': 3,
            'smq_source': 4, 'smq_note': 5, 'meddra_version': 6, 'status': 7, 'smq_algorithm': 8
        }, str(data_dir))

        # 8. SMQ Content
        process_file('smq_content.asc', MeddraSMQContent, {
            'smq_code': 0, 'term_code': 1, 'term_level': 2, 'term_scope': 3,
            'term_category': 4, 'term_weight': 5, 'term_status': 6,
            'term_addition_version': 7, 'term_last_modified_version': 8
        }, str(data_dir))

        print("\n[!] MedDRA Population complete.")

if __name__ == '__main__':
    run_import()
