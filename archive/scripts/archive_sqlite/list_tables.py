import sqlite3
conn = sqlite3.connect('data/afd.db')
print([t[0] for t in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()])
conn.close()
