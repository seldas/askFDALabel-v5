import os
import sys
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'backend')))
import openpyxl
import re
from dashboard import create_app
from dashboard.extensions import db
from dashboard.models import PgxBiomarker, PgxSynonym

def populate_biomarker_db():
    app = create_app()
    with app.app_context():
        # 1. Clear existing data
        print("Clearing existing PGx tables...")
        PgxBiomarker.query.delete()
        PgxSynonym.query.delete()
        db.session.commit()

        file_path = os.path.join('data', 'downloads', 'biomarker_db', 'Table of Pharmacogenomic Biomarkers in Drug Labeling  FDA.xlsx')
        if not os.path.exists(file_path):
            print(f"File not found: {file_path}")
            return

        print(f"Reading {file_path}...")
        wb = openpyxl.load_workbook(file_path)
        sheet = wb.active
        
        biomarker_rows = []
        synonym_map = {} # term -> set(canonical_names)
        
        # Iterate rows
        count_drugs = 0
        for row in sheet.iter_rows(min_row=3, values_only=True):
            # row indices: 0=\xa0, 1=Drug, 2=Therapeutic Area, 3=Biomarker, 4=Sections
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
            
            # Parse Synonyms for Dictionary
            # Logic similar to previous build_biomarker_map
            raw_name = str(biomarker_raw).strip()
            canonical = raw_name
            
            terms = []
            
            # 1. Handle "Nonspecific (Description)"
            if raw_name.startswith("Nonspecific"):
                match = re.search(r'\((.*?)\)', raw_name)
                if match:
                    desc = match.group(1)
                    terms.append(desc)
            else:
                # 2. Handle "Sym, Sym (Syn)" or "Sym (Syn)"
                parts = raw_name.split('(')
                symbols_part = parts[0]
                synonym_part = parts[1].replace(')', '') if len(parts) > 1 else ""
                
                # Process symbols (comma sep)
                for sym in symbols_part.split(','):
                    clean_sym = sym.strip()
                    if clean_sym:
                        terms.append(clean_sym)
                
                # Process synonym
                if synonym_part:
                    terms.append(synonym_part.strip())
            
            for t in terms:
                t_lower = t.lower()
                if t_lower not in synonym_map:
                    synonym_map[t_lower] = set()
                synonym_map[t_lower].add(canonical)

        # Populate Synonym Table
        # Note: A single term like "HER2" might map to "ERBB2 (HER2)".
        # What if "HER2" maps to multiple canonicals?
        # e.g. if one entry is "ERBB2 (HER2)" and another is "Just HER2" (unlikely in this table but possible).
        # We will pick the most descriptive one or just store one.
        # Since 'normalized_name' is a string, if we have collisions, we might need a choice.
        # For simplicity, we'll store the first one or the longest one.
        # Ideally, we map search term -> canonical.
        
        count_synonyms = 0
        for term, canonicals in synonym_map.items():
            # If multiple canonicals, pick one (e.g. sorted by length desc to keep most info)
            # Actually, if they are different biomarkers, we might miss one.
            # But usually FDA table is consistent.
            # Let's just pick one for the scan mapping. The scan finds the "term".
            # The AI verification step will see the term and the context.
            # We map it to *a* canonical name so we can report "Detected as X for Y".
            
            target_canonical = list(canonicals)[0]
            
            # Create Synonym
            # Ensure unique term
            existing = PgxSynonym.query.filter_by(term=term).first()
            if not existing:
                syn = PgxSynonym(term=term, normalized_name=target_canonical)
                db.session.add(syn)
                count_synonyms += 1
        
        db.session.commit()
        print(f"Successfully populated {count_drugs} drug-biomarker pairs.")
        print(f"Successfully populated {count_synonyms} search terms/synonyms.")

if __name__ == '__main__':
    populate_biomarker_db()
