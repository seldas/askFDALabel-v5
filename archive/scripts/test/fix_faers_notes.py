import json
import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from srcs.extensions import db
from srcs.models import Annotation
from backend.dashboard.app import create_app

app = create_app()

with app.app_context():
    notes = Annotation.query.all()
    count = 0
    for note in notes:
        updated = False
        
        # 1. Clean Answer Content
        # Check for old header style
        if '**Yes** (verified by AI)' in note.answer:
            # Try to keep only the blockquote part
            lines = note.answer.split('\n')
            quote_lines = [l for l in lines if l.strip().startswith('>')]
            if quote_lines:
                note.answer = "\n".join(quote_lines)
                updated = True
        
        # 2. Ensure Keyword and Public Status for FAERS notes
        # Heuristic: Question starts with "Is " and Answer is a blockquote
        if note.question.startswith('Is "') and note.answer.strip().startswith('>'):
            # Make public
            if not note.is_public:
                note.is_public = True
                updated = True
            
            # Add match tag
            try:
                kw_list = json.loads(note.keywords) if note.keywords else []
                if not isinstance(kw_list, list): kw_list = []
            except:
                kw_list = []
                
            has_tag = any(k in ['match:yes', 'match:probable'] for k in kw_list)
            
            if not has_tag:
                # Default to yes for legacy notes
                kw_list.append('match:yes')
                note.keywords = json.dumps(kw_list)
                updated = True

        if updated:
            count += 1

    if count > 0:
        db.session.commit()
        print(f"Updated {count} annotations.")
    else:
        print("No annotations needed update.")
