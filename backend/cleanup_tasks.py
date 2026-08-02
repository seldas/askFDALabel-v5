import os
import pandas as pd
from app import create_unified_app
from database import db
from database.models import WebtestTask, WebtestHistory

app = create_unified_app()
with app.app_context():
    # 1. Read the active templates
    df1 = pd.read_excel('webtest/Testing_Template_11152022.xlsx')
    df2 = pd.read_excel('webtest/Testing_Template_11152022_public.xlsx')
    
    active_urls = set()
    for url in list(df1['Result Link'].dropna()) + list(df2['Result Link'].dropna()):
        if str(url).strip() and str(url).strip() != 'N/A':
            active_urls.add(str(url).strip())
            
    print(f"Total active URLs in templates: {len(active_urls)}")
    
    tasks = WebtestTask.query.all()
    to_delete = []
    for t in tasks:
        if str(t.url).strip() not in active_urls:
            to_delete.append(t)
            
    print(f"Found {len(to_delete)} tasks that are historical cruft and not in active templates.")
    
    for t in to_delete:
        db.session.delete(t)
        
    db.session.commit()
    print(f"Successfully deleted {len(to_delete)} obsolete tasks. Remaining tasks: {WebtestTask.query.count()}")
