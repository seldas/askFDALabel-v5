import os
import sys
import openpyxl
import re
from pathlib import Path

# Add backend to path
root_dir = Path(__file__).resolve().parent.parent.parent
sys.path.append(str(root_dir / 'backend'))

from database import db, PgxBiomarker, PgxSynonym
from dashboard import create_app

def populate_pgx():
    app = create_app()
    with app.app_context():
        # 1. Clear existing data
        print("=== PGx Data Importer ===")
        print("Clearing existing PGx tables...")
        PgxBiomarker.query.delete()
        PgxSynonym.query.delete()
        db.session.commit()

        root_dir = Path(__file__).resolve().parent.parent.parent
        file_path = root_dir / 'data' / 'downloads' / 'biomarker_db' / 'Table of Pharmacogenomic Biomarkers in Drug Labeling  FDA.xlsx'
        
        if not file_path.exists():
            print(f"File not found: {file_path}")
            return

        print(f"Reading {file_path}...")
        wb = openpyxl.load_workbook(file_path)
        sheet = wb.active
        
        synonym_map = {} # term -> set(canonical_names)
        
        # Iterate rows
        count_drugs = 0
        for row in sheet.iter_rows(min_row=3, values_only=True):
            if not row[1]: 
                continue
            
            drug_name = str(row[1]).strip()
            # Clean drug name (remove footnotes)
            if '(' in drug_name and drug_name.endswith(')'):
                 parts = drug_name.rsplit(' (', 1)
                 if len(parts) == 2 and parts[1][:-1].isdigit():
                     drug_name = parts[0]

            therapeutic_area = row[2]
            biomarker_raw = row[3]
            sections = row[4]

            if not biomarker_raw:
                continue

            # Add to Biomarker Table
            record = PgxBiomarker(
                drug_name=drug_name,
                therapeutic_area=therapeutic_area,
                biomarker_name=biomarker_raw,
                labeling_sections=sections
            )
            db.session.add(record)
            count_drugs += 1
            
            # Parse Synonyms
            raw_name = str(biomarker_raw).strip()
            canonical = raw_name
            terms = []
            
            if raw_name.startswith("Nonspecific"):
                match = re.search(r'\((.*?)\)', raw_name)
                if match:
                    desc = match.group(1)
                    terms.append(desc)
            else:
                parts = raw_name.split('(')
                symbols_part = parts[0]
                synonym_part = parts[1].replace(')', '') if len(parts) > 1 else ""
                
                for sym in symbols_part.split(','):
                    clean_sym = sym.strip()
                    if clean_sym:
                        terms.append(clean_sym)
                
                if synonym_part:
                    terms.append(synonym_part.strip())
            
            for t in terms:
                t_lower = t.lower()
                if t_lower not in synonym_map:
                    synonym_map[t_lower] = set()
                synonym_map[t_lower].add(canonical)

        # Populate Synonym Table
        count_synonyms = 0
        for term, canonicals in synonym_map.items():
            target_canonical = list(canonicals)[0]
            existing = PgxSynonym.query.filter_by(term=term).first()
            if not existing:
                syn = PgxSynonym(term=term, normalized_name=target_canonical)
                db.session.add(syn)
                count_synonyms += 1
        
        db.session.commit()
        print(f"Successfully populated {count_drugs} drug-biomarker pairs.")
        print(f"Successfully populated {count_synonyms} search terms/synonyms.")

if __name__ == '__main__':
    populate_pgx()
