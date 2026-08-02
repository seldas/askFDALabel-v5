import pandas as pd
from database import db, DrugToxicity
from dashboard import create_app

app = create_app()

def reset_drugtox():
    with app.app_context():
        print("Dropping DrugToxicity table...")
        DrugToxicity.__table__.drop(db.engine, checkfirst=True)
        
        print("Recreating DrugToxicity table...")
        DrugToxicity.__table__.create(db.engine, checkfirst=True)
        
        excel_path = '/data/downloads/ALT_update_latest.xlsx'
        print(f"Loading data from {excel_path}...")
        df = pd.read_excel(excel_path)
        
        # Fill NaN with empty string
        df = df.fillna('')
        
        import re
        from datetime import datetime
        
        records = []
        for idx, row in df.iterrows():
            if not row.get('SETID'):
                continue
                
            update_notes = str(row.get('Update_Notes', ''))
            assessment_date = ''
            
            # Extract date like 01/29/2025
            date_match = re.search(r'(\d{2}/\d{2}/\d{4})', update_notes)
            if date_match:
                try:
                    dt_obj = datetime.strptime(date_match.group(1), '%m/%d/%Y')
                    assessment_date = dt_obj.strftime('%Y%m%d')
                except ValueError:
                    pass
            
            records.append(DrugToxicity(
                SETID=str(row['SETID']),
                Toxicity_Class=str(row.get('Toxicity Class', '')),
                Tox_Type=str(row.get('Tox Type', '')),
                AI_Summary=str(row.get('AI Summary', '')),
                Evidence=str(row.get('Evidence', '')),
                Update_Notes=update_notes,
                is_historical=0,
                endpoint=str(row.get('Toxicity Class', '')),
                AI_Model="vLLM (Llama-4)",
                Assessment_Date=assessment_date
            ))
            
            if len(records) >= 1000:
                db.session.bulk_save_objects(records)
                db.session.commit()
                print(f"Inserted {idx+1} records...")
                records = []
                
        if records:
            db.session.bulk_save_objects(records)
            db.session.commit()
            
        print("Finished recreating and populating DrugToxicity!")

if __name__ == "__main__":
    reset_drugtox()
