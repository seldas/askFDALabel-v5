import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from srcs import create_app
from srcs.models import PgxSynonym
import re

app = create_app()
with app.app_context():
    # 1. Check Synonym
    term = "factor v leiden"
    syn = PgxSynonym.query.filter_by(term=term).first()
    print(f"Synonym '{term}' found: {syn.normalized_name if syn else 'No'}")
    
    # 2. Check Regex logic
    text = "The risk of VTE is increased in patients with Factor V Leiden mutation."
    
    # Simulate build_biomarker_map logic for this term
    term_map = {term: "F5 (Factor V Leiden)"}
    
    all_terms = sorted(term_map.keys(), key=len, reverse=True)
    escaped_terms = [re.escape(t) for t in all_terms]
    pattern_str = r'\b(' + '|'.join(escaped_terms) + r')\b'
    
    print(f"Regex Pattern: {pattern_str}")
    
    pattern = re.compile(pattern_str, re.IGNORECASE)
    matches = set(pattern.findall(text))
    print(f"Matches in text: {matches}")
