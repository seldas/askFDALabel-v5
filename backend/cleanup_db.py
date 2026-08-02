from app import create_unified_app
from database.models import db, DrugToxicity
from dateutil import parser
import re

def clean_database():
    app = create_unified_app()
    with app.app_context():
        print("--- Starting Database Cleanup ---")
        
        # 1. Fix Toxicity_Class
        precaution_records = DrugToxicity.query.filter_by(Toxicity_Class='Precaution').all()
        print(f"Found {len(precaution_records)} records with 'Precaution'. Updating to 'No'...")
        for rec in precaution_records:
            rec.Toxicity_Class = 'No'
            # Also fix endpoint if it was Precaution
            if rec.endpoint == 'Precaution':
                rec.endpoint = 'No'
        
        # 2. Fix SPL_Effective_Time
        all_records = DrugToxicity.query.all()
        date_fixed_count = 0
        for rec in all_records:
            if rec.SPL_Effective_Time and not rec.SPL_Effective_Time.isdigit():
                original_date = rec.SPL_Effective_Time
                try:
                    # Parse the string date
                    parsed_date = parser.parse(original_date)
                    # Format to YYYYMMDD
                    formatted_date = parsed_date.strftime('%Y%m%d')
                    rec.SPL_Effective_Time = formatted_date
                    date_fixed_count += 1
                except Exception as e:
                    print(f"Could not parse date '{original_date}' for SETID {rec.SETID}: {e}")
        
        print(f"Fixed {date_fixed_count} textual dates.")
        
        try:
            db.session.commit()
            print("Database cleanup completed and committed successfully.")
        except Exception as e:
            db.session.rollback()
            print(f"Error committing to database: {e}")

if __name__ == '__main__':
    clean_database()
