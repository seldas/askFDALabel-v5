import sqlite3
import os

def fix_columns():
    db_path = 'data/afd.db'
    if not os.path.exists(db_path):
        print(f"Database not found at {db_path}")
        return

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Check existing columns
    cursor.execute("PRAGMA table_info(favorite)")
    existing_cols = [row[1] for row in cursor.fetchall()]

    columns_to_add = [
        ('active_ingredients', 'TEXT'),
        ('labeling_type', 'VARCHAR(200)'),
        ('dosage_forms', 'VARCHAR(500)'),
        ('routes', 'VARCHAR(500)'),
        ('epc', 'VARCHAR(500)'),
        ('fdalabel_link', 'VARCHAR(500)'),
        ('dailymed_spl_link', 'VARCHAR(500)'),
        ('dailymed_pdf_link', 'VARCHAR(500)'),
        ('product_type', 'VARCHAR(50)'),
        ('label_format', 'VARCHAR(50)'),
        ('source', 'VARCHAR(50)')
    ]

    for col_name, col_type in columns_to_add:
        if col_name not in existing_cols:
            print(f"Adding column {col_name} to favorite table...")
            try:
                cursor.execute(f"ALTER TABLE favorite ADD COLUMN {col_name} {col_type}")
            except Exception as e:
                print(f"Error adding column {col_name}: {e}")
        else:
            print(f"Column {col_name} already exists.")

    conn.commit()
    conn.close()
    print("Database fix complete.")

if __name__ == "__main__":
    fix_columns()
