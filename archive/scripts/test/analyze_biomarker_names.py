import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from srcs import create_app
from srcs.models import PgxBiomarker
from srcs.extensions import db

app = create_app()
with app.app_context():
    names = db.session.query(PgxBiomarker.biomarker_name).distinct().all()
    names = [n[0] for n in names]
    
    print(f"Total distinct biomarkers: {len(names)}")
    print("--- Sample Names ---")
    for n in names[:20]:
        print(n)
        
    print("\n--- Potential Synonyms (with parentheses) ---")
    with_parens = [n for n in names if '(' in n]
    for n in with_parens[:20]:
        print(n)
