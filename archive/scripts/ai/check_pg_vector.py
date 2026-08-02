import os
import psycopg2
from dotenv import load_dotenv
load_dotenv()
conn = psycopg2.connect(os.getenv('DATABASE_URL'))
cursor = conn.cursor()
cursor.execute("SELECT * FROM pg_extension WHERE extname = 'vector'")
print('Vector extension:', cursor.fetchone() is not None)
cursor.execute("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'label_embeddings')")
print('Table exists:', cursor.fetchone()[0])
conn.close()
