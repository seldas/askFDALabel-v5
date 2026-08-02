from app import create_unified_app
from database.models import DrugToxicity

def inspect_db2():
    app = create_unified_app()
    with app.app_context():
        records = DrugToxicity.query.all()
        weird_dates = [r for r in records if r.SPL_Effective_Time and not r.SPL_Effective_Time.isdigit()]
        print(f"Total non-numeric dates: {len(weird_dates)}")
        for w in weird_dates[:10]:
            print(f"  {w.SPL_Effective_Time}")

if __name__ == '__main__':
    inspect_db2()
