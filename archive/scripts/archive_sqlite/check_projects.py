import sqlite3
import os

db_path = 'data/afd.db'
if not os.path.exists(db_path):
    print("DB not found")
    exit(1)

conn = sqlite3.connect(db_path)
cursor = conn.cursor()
cursor.execute("SELECT id, title, owner_id FROM project")
rows = cursor.fetchall()
print(f"Total projects: {len(rows)}")
for row in rows:
    print(row)
conn.close()
