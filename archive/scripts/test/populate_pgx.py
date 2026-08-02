import os
import sys
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'backend')))
import openpyxl
from dashboard import create_app
from dashboard.extensions import db
from dashboard.models import PgxBiomarker

def populate_pgx():
    app = create_app()
    with app.app_context():
        # Clear existing data? Maybe better to just add/update. 
        # For now, let's clear to avoid duplicates if re-run, or check existence.
        print("Clearing existing PGx biomarkers...")
        PgxBiomarker.query.delete()
        db.session.commit()

        file_path = os.path.join('data', 'downloads', 'biomarker_db', 'Table of Pharmacogenomic Biomarkers in Drug Labeling  FDA.xlsx')
        if not os.path.exists(file_path):
            print(f"File not found: {file_path}")
            return

        print(f"Reading {file_path}...")
        wb = openpyxl.load_workbook(file_path)
        sheet = wb.active
        
        # Skip header rows. We saw header was around row 2 (1-based).
        # Let's iterate from row 3.
        count = 0
        for row in sheet.iter_rows(min_row=3, values_only=True):
            # row indices: 0=\xa0, 1=Drug, 2=Therapeutic Area, 3=Biomarker, 4=Sections
            if not row[1]: # No drug name
                continue
            
            drug_name = str(row[1]).strip()
            # Clean up drug name (remove footnotes like (1), (2))
            # Actually, "Abemaciclib (1)" might be distinct entry. 
            # But usually we match by "Abemaciclib". 
            # If the label has same set_id for both, we want all biomarkers.
            # I'll store the raw name for now, or maybe strip the (N) suffix.
            # Let's strip the suffix for easier matching, assuming standard drug names.
            if '(' in drug_name and drug_name.endswith(')'):
                 # Check if it looks like "Name (1)"
                 parts = drug_name.rsplit(' (', 1)
                 if len(parts) == 2 and parts[1][:-1].isdigit():
                     drug_name = parts[0]

            therapeutic_area = row[2]
            biomarker = row[3]
            sections = row[4]

            # Create record
            # We might have duplicates if we stripped the suffix.
            # e.g. Abemaciclib (1) -> ESR, Abemaciclib (2) -> ERBB2
            # We want both for "Abemaciclib".
            # Check if this exact combination exists?
            
            # Since we cleared table, we just add.
            
            record = PgxBiomarker(
                drug_name=drug_name,
                therapeutic_area=therapeutic_area,
                biomarker_name=biomarker,
                labeling_sections=sections
            )
            db.session.add(record)
            count += 1
        
        db.session.commit()
        print(f"Successfully populated {count} PGx biomarkers.")

if __name__ == '__main__':
    populate_pgx()
