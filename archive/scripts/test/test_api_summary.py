import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from backend.dashboard.app import create_app
from srcs.routes.api import ai_compare_summary
from flask import json

app = create_app()

def test_summary():
    with app.test_request_context(
        '/ai_compare_summary',
        method='POST',
        data=json.dumps({
            'set_ids': ['id1', 'id2'],
            'differing_sections': [{'title': 'Test', 'content1': 'A', 'content2': 'B'}],
            'label1_name': 'L1',
            'label2_name': 'L2',
            'force_refresh': True,
            'generate_if_missing': True
        }),
        content_type='application/json'
    ):
        try:
            # We need to mock summarize_comparison to avoid actual API call if possible, 
            # or just let it run (and fail on API key if missing, but that would be a handled exception).
            # If it fails with 500 HTML, the route function itself is crashing.
            
            # Since I can't easily mock imports in this script without mock lib, 
            # I'll rely on the fact that if it crashes before the AI call, I'll see it.
            # If it crashes AT the AI call, it should return JSON error.
            
            res = ai_compare_summary()
            print(f"Status Code: {res.status_code}")
            print(f"Response: {res.get_data(as_text=True)}")
        except Exception as e:
            import traceback
            traceback.print_exc()

if __name__ == "__main__":
    test_summary()
