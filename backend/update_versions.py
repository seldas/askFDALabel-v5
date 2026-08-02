import os
from app import create_unified_app
from database import db
from database.models import WebtestTask, WebtestHistory

app = create_unified_app()
with app.app_context():
    tasks = WebtestTask.query.all()
    updated = 0
    for t in tasks:
        url_lower = t.url.lower()
        if 'ncsvmdbbapp-dev' in url_lower:
            t.version = 'DEV'
        elif 'ncsvmlblapptst2' in url_lower:
            t.version = 'TEST'
        elif 'nctr-crs' in url_lower or 'cder' in url_lower:
            t.version = 'CDER-CBER'
        elif '8443' in url_lower:
            t.version = 'FDA'
        elif 'fdalabel.fda.gov' in url_lower:
            t.version = 'PUBLIC'
        else:
            t.version = 'Unknown'
        updated += 1
    
    # Also fix histories so that the charts show DEV and TEST correctly instead of 'N/A'
    histories = WebtestHistory.query.all()
    for h in histories:
        if h.version == 'N/A' or h.version == 'Unknown' or h.version == '' or not h.version:
            url_lower = h.url.lower() if h.url else ''
            if 'ncsvmdbbapp-dev' in url_lower:
                h.version = 'DEV'
            elif 'ncsvmlblapptst2' in url_lower:
                h.version = 'TEST'
            elif 'nctr-crs' in url_lower or 'cder' in url_lower:
                h.version = 'CDER-CBER'
            elif '8443' in url_lower:
                h.version = 'FDA'
            elif 'fdalabel.fda.gov' in url_lower:
                h.version = 'PUBLIC'
            else:
                h.version = 'Unknown'

    db.session.commit()
    print(f'Updated {updated} tasks and corresponding histories to include DEV and TEST.')
