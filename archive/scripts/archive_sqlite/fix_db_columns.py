import sqlite3
import os

db_path = 'data/afd.db'

if not os.path.exists(db_path):
    print(f"Database not found at {db_path}")
    exit(1)

try:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    print("Adding missing columns to 'favorite' table...")
    
    # List of columns to add
    new_columns = [
        ('generic_name', 'VARCHAR(500)'),
        ('market_category', 'VARCHAR(200)'),
        ('application_number', 'VARCHAR(200)'),
        ('ndc', 'VARCHAR(500)')
    ]
    
    for col_name, col_type in new_columns:
        try:
            cursor.execute(f"ALTER TABLE favorite ADD COLUMN {col_name} {col_type}")
            print(f"  [+] Added column: {col_name}")
        except sqlite3.OperationalError as e:
            if "duplicate column name" in str(e):
                print(f"  [i] Column {col_name} already exists. Skipping.")
            else:
                print(f"  [!] Error adding {col_name}: {e}")
                
    conn.commit()
    print("[SUCCESS] Database schema updated.")
    
except Exception as e:
    print(f"Critical error: {e}")
finally:
    if conn:
        conn.close()
