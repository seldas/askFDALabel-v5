import collections
from app import create_unified_app
from database.models import WebtestTask

app = create_unified_app()
with app.app_context():
    tasks = WebtestTask.query.all()
    queries = collections.defaultdict(list)
    for t in tasks:
        queries[t.query_details].append((t.version, t.url))
    
    for q, versions in queries.items():
        print(f'Query: {q[:40]}...')
        for v, url in versions:
            print(f'   - {v}: {url}')
    
    print(f'Total Queries: {len(queries)}')
    print(f'Total Tasks: {len(tasks)}')
