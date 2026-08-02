import psycopg2
import os
from dotenv import load_dotenv
from pathlib import Path

def enable_pgvector():
    # Dynamic path resolution to support both host execution and container environments
    current_dir = Path(__file__).resolve().parent
    env_path = None
    for parent in [current_dir] + list(current_dir.parents):
        if (parent / '.env').exists() or (parent / '.env.template.txt').exists():
            env_path = parent / '.env'
            break
    if not env_path:
        env_path = current_dir / '.env'

    load_dotenv(dotenv_path=env_path)
    
    db_url = os.getenv('DATABASE_URL')
    if not db_url:
        print("DATABASE_URL not found in .env")
        return

    # Replace 'db' with 'localhost' if running from host (outside Docker container)
    if not os.path.exists('/.dockerenv'):
        if '@db:' in db_url:
            db_url = db_url.replace('@db:', '@localhost:')
        elif 'db:5432' in db_url:
            db_url = db_url.replace('db:5432', 'localhost:5432')

    try:
        conn = psycopg2.connect(db_url)
        conn.autocommit = True
        with conn.cursor() as cur:
            print("Enabling pgvector extension...")
            cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")
            print("Success!")
        conn.close()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    enable_pgvector()
