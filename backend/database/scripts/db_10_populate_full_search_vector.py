#!/usr/bin/env python3
"""
db_10_populate_full_search_vector.py

Standalone, high-performance migration script to populate the document-level
`full_search_vector` column on `labeling.sum_spl` in PostgreSQL.

Populates document-level TSVECTOR data across existing records by combining:
  1. Relational metadata (product_names, generic_names, active_ingredients, manufacturer)
  2. Aggregated section text from `labeling.spl_sections`

Executes in-place SQL updates in batches without requiring XML re-import or disk file re-parsing.

Usage:
  python backend/database/scripts/db_10_populate_full_search_vector.py [--batch-size 5000]
"""

import argparse
import sys
import time
from pathlib import Path

# Path setup for standalone or containerized execution
current_dir = Path(__file__).resolve().parent
for parent in [current_dir] + list(current_dir.parents):
    if (parent / 'backend').exists():
        sys.path.append(str(parent / 'backend'))
        break
    elif (parent / 'pg_utils.py').exists() or (parent / 'database' / 'scripts').exists():
        sys.path.append(str(parent))
        break

from pg_utils import PGUtils


def populate_full_search_vector(batch_size=5000):
    start_time = time.time()
    print("=" * 70)
    print("Populating Document-Level `full_search_vector` in PostgreSQL")
    print("=" * 70)

    conn = PGUtils.get_connection()
    conn.autocommit = True

    try:
        with conn.cursor() as cur:
            # 1. Ensure column exists
            print("[1/4] Ensuring column 'full_search_vector' exists on 'labeling.sum_spl'...")
            cur.execute("ALTER TABLE labeling.sum_spl ADD COLUMN IF NOT EXISTS full_search_vector TSVECTOR;")

            # 2. Fetch unpopulated or total spl_ids
            print("[2/4] Fetching candidate SPL IDs for vector population...")
            cur.execute("SELECT spl_id FROM labeling.sum_spl WHERE full_search_vector IS NULL;")
            unpopulated = [row[0] for row in cur.fetchall()]

            if not unpopulated:
                print("      All sum_spl records already have populated full_search_vector.")
            else:
                total_unpopulated = len(unpopulated)
                print(f"      Found {total_unpopulated:,} records needing full_search_vector updates.")
                print(f"      Processing in batches of {batch_size:,}...")

                processed = 0
                for i in range(0, total_unpopulated, batch_size):
                    batch_ids = unpopulated[i:i + batch_size]
                    
                    cur.execute("""
                        UPDATE labeling.sum_spl s
                        SET full_search_vector = 
                            to_tsvector('english', 
                                coalesce(s.product_names, '') || ' ' || 
                                coalesce(s.generic_names, '') || ' ' || 
                                coalesce(s.active_ingredients, '') || ' ' ||
                                coalesce(s.manufacturer, '')
                            ) || coalesce((
                                SELECT to_tsvector('english', string_agg(coalesce(sec.content_xml, ''), ' '))
                                FROM labeling.spl_sections sec
                                WHERE sec.spl_id = s.spl_id
                            ), to_tsvector('english', ''))
                        WHERE s.spl_id = ANY(%s);
                    """, (batch_ids,))

                    processed += len(batch_ids)
                    pct = (processed / total_unpopulated) * 100
                    elapsed = time.time() - start_time
                    rate = processed / elapsed if elapsed > 0 else 0
                    print(f"      Updated {processed:,}/{total_unpopulated:,} ({pct:.1f}%) [{rate:.0f} records/sec]")

            # 3. Create GIN Index
            print("[3/4] Ensuring GIN index 'idx_sum_spl_full_fts' exists on 'full_search_vector'...")
            index_start = time.time()
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_sum_spl_full_fts 
                ON labeling.sum_spl USING GIN (full_search_vector);
            """)
            print(f"      GIN index build complete in {time.time() - index_start:.2f}s.")

            # 4. Final verification
            print("[4/4] Verifying vector coverage...")
            cur.execute("SELECT COUNT(*) FROM labeling.sum_spl WHERE full_search_vector IS NOT NULL;")
            populated_count = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM labeling.sum_spl;")
            total_count = cur.fetchone()[0]

            print(f"[SUCCESS] {populated_count:,}/{total_count:,} sum_spl records indexed.")
            print(f"Total time elapsed: {time.time() - start_time:.2f}s.")

    except Exception as e:
        print(f"[ERROR] Failed to populate full_search_vector: {e}", file=sys.stderr)
        raise
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description="Populate Document-Level full_search_vector in PostgreSQL")
    parser.add_argument("--batch-size", type=int, default=5000, help="Batch size for vector update statements")
    args = parser.parse_args()

    populate_full_search_vector(batch_size=args.batch_size)


if __name__ == "__main__":
    main()
