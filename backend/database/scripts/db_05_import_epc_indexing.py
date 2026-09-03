import os
import sys
import zipfile
import re
import multiprocessing
try:
    import defusedxml.ElementTree as ET
except ImportError:
    import xml.etree.ElementTree as ET
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor, as_completed
import psycopg2
from psycopg2.extras import execute_values, RealDictCursor

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

# Resolve data directory
if os.path.exists('/data'):
    data_dir = Path('/data')
else:
    data_dir = repo_root / 'data'

# Add scripts directory for pg_utils import
sys.path.append(str(current_dir))

from pg_utils import PGUtils

NS = {'ns': 'urn:hl7-org:v3'}

# List of substances that are too common/general to be used for class mapping
# especially when they appear as secondary parts of a substance
IGNORED_SUBSTANCES = {
    'SODIUM CATION', 'POTASSIUM CATION', 'MAGNESIUM CATION', 'CALCIUM CATION',
    'SULFATE ION', 'CHLORIDE ION', 'PHOSPHATE ION', 'WATER', 'NITROGEN', 'OXYGEN'
}

def get_el_text(el):
    return "".join(el.itertext()).strip() if el is not None else ""

def parse_indexing_zip(zip_path):
    """Parses a Pharmacologic Class Indexing SPL ZIP."""
    results = []
    try:
        with zipfile.ZipFile(zip_path, 'r') as z:
            xml_files = [f for f in z.namelist() if f.endswith('.xml')]
            if not xml_files: return []
            with z.open(xml_files[0]) as f:
                xml_content = f.read()
        
        root = ET.fromstring(xml_content)
        
        # Check if it's actually an indexing document
        doc_code_el = root.find('ns:code', NS)
        if doc_code_el is None or doc_code_el.get('code') != '60685-5':
            return []

        # Find substance and its classes
        subjects = root.findall('.//ns:section/ns:subject/ns:identifiedSubstance', NS)
        for subject in subjects:
            sub_id_el = subject.find('ns:id', NS)
            sub_unii = sub_id_el.get('extension') if sub_id_el is not None else ""
            
            inner_sub = subject.find('ns:identifiedSubstance', NS)
            if inner_sub is None: continue
            
            sub_name = get_el_text(inner_sub.find('ns:name', NS))
            if sub_name.upper() in IGNORED_SUBSTANCES: continue
            
            for spec in inner_sub.findall('ns:asSpecializedKind/ns:generalizedMaterialKind', NS):
                code_el = spec.find('ns:code', NS)
                if code_el is not None:
                    idx_code = code_el.get('code')
                    idx_name = code_el.get('displayName')
                    
                    idx_type = "Unknown"
                    if idx_name:
                        if "[EPC]" in idx_name: idx_type = "EPC"
                        elif "[MoA]" in idx_name: idx_type = "MoA"
                        elif "[PE]" in idx_name: idx_type = "PE"
                        elif "[Chemical/Ingredient]" in idx_name: idx_type = "Chemical"
                    
                    results.append({
                        'substance_unii': sub_unii,
                        'substance_name': sub_name,
                        'indexing_code': idx_code,
                        'indexing_name': idx_name,
                        'indexing_type': idx_type
                    })
        return results
    except Exception as e:
        return []

def main():
    indexing_dir = data_dir / "downloads" / "pharmacologic_class_indexing_spl_files"
    if not indexing_dir.exists():
        print(f"Directory not found: {indexing_dir}")
        return

    zip_files = list(indexing_dir.glob("*.zip"))
    print(f"Found {len(zip_files)} indexing ZIP files.")

    # 1. Create table
    print("Creating indexing tables...")
    PGUtils.execute_query("""
        CREATE TABLE IF NOT EXISTS labeling.substance_indexing (
            id SERIAL PRIMARY KEY,
            substance_unii TEXT,
            substance_name TEXT,
            indexing_code TEXT,
            indexing_name TEXT,
            indexing_type TEXT
        );
        TRUNCATE TABLE labeling.substance_indexing;
    """)

    # 2. Parse files
    all_data = []
    print(f"Parsing indexing files using {multiprocessing.cpu_count()} workers...")
    with ProcessPoolExecutor(max_workers=multiprocessing.cpu_count()) as executor:
        futures = {executor.submit(parse_indexing_zip, z): z for z in zip_files}
        for i, future in enumerate(as_completed(futures)):
            data = future.result()
            if data:
                all_data.extend(data)
            if (i+1) % 500 == 0:
                print(f"Parsed {i+1}/{len(zip_files)} files...")

    print(f"Extracted {len(all_data)} indexing records. Inserting into database...")

    # 3. Insert into database
    conn = PGUtils.get_connection()
    try:
        with conn.cursor() as cur:
            cols = ['substance_unii', 'substance_name', 'indexing_code', 'indexing_name', 'indexing_type']
            query = f"INSERT INTO labeling.substance_indexing ({', '.join(cols)}) VALUES %s ON CONFLICT DO NOTHING"
            data_tuples = [[d[c] for c in cols] for d in all_data]
            execute_values(cur, query, data_tuples)
        conn.commit()
        print("Insertion complete.")
    finally:
        conn.close()

    # 4. Populate epc_map and update sum_spl
    print("Updating epc_map and sum_spl EPC column...")
    PGUtils.execute_query("""
        -- Clear old epc_map entries that might be stale
        TRUNCATE TABLE labeling.epc_map;

        -- Insert into epc_map by matching UNII first, then substance names
        -- ONLY match against ACTIVE ingredients to avoid tagging by common excipients/ions
        INSERT INTO labeling.epc_map (spl_id, epc_term)
        SELECT DISTINCT m.spl_id, i.indexing_name
        FROM labeling.active_ingredients_map m
        JOIN labeling.substance_indexing i ON (
            (m.unii != '' AND m.unii = i.substance_unii) OR 
            (m.unii = '' AND UPPER(m.substance_name) = UPPER(i.substance_name))
        )
        WHERE i.indexing_type = 'EPC' AND m.is_active = 1
        ON CONFLICT DO NOTHING;

        -- Clear existing EPC column in sum_spl to remove incorrect/old mappings
        UPDATE labeling.sum_spl SET epc = '';

        -- Update sum_spl EPC column with aggregated terms
        WITH agg_epc AS (
            SELECT spl_id, string_agg(DISTINCT epc_term, '; ') as epcs
            FROM labeling.epc_map
            GROUP BY spl_id
        )
        UPDATE labeling.sum_spl s
        SET epc = a.epcs
        FROM agg_epc a
        WHERE s.spl_id = a.spl_id;
    """)
    print("EPC information populated successfully.")

if __name__ == "__main__":
    main()
