from app import create_unified_app
from database.models import DrugToxicity
from sqlalchemy import text

def inspect_db():
    app = create_unified_app()
    with app.app_context():
        # Let's find weird dates or weird toxicity classes
        print("--- Testing DrugToxicity ---")
        records = DrugToxicity.query.all()
        
        weird_dates = [r for r in records if r.SPL_Effective_Time and "apri" in r.SPL_Effective_Time.lower()]
        for w in weird_dates:
            print(f"Weird Date - ID: {w.id}, SETID: {w.SETID}, Date: {w.SPL_Effective_Time}, Trade: {w.Trade_Name}")
            
        weird_class = [r for r in records if not r.Toxicity_Class or r.Toxicity_Class.lower() not in ['most', 'less', 'no']]
        print(f"\nTotal records: {len(records)}")
        print(f"Records with non-standard Toxicity_Class: {len(weird_class)}")
        
        for i, c in enumerate(weird_class[:20]):
            print(f"  {c.SETID} [{c.Tox_Type}]: '{c.Toxicity_Class}'")

if __name__ == '__main__':
    inspect_db()
