import os
import sqlite3
import sys

def test_db():
    db_path = "data/label.db"
    if not os.path.exists(db_path):
        print(f"Error: Database not found at {db_path}")
        return

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # 1. Check total count
    cursor.execute("SELECT count(*) FROM sum_spl")
    count = cursor.fetchone()[0]
    print(f"Total records in sum_spl: {count}")
    
    # 2. Test Random
    print("\nTesting RANDOM() query...")
    cursor.execute("SELECT set_id, product_names FROM sum_spl ORDER BY RANDOM() LIMIT 5")
    rows = cursor.fetchall()
    if not rows:
        print("RANDOM query returned NO rows.")
    for row in rows:
        print(f" - {row['set_id']}: {row['product_names']}")
        
    conn.close()

if __name__ == "__main__":
    test_db()
