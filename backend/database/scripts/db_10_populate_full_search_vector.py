#!/usr/bin/env python3
"""
db_10_populate_full_search_vector.py

In-place migration that populates the document-level `full_search_vector` column
on `labeling.sum_spl` for a database imported before that column existed.

No XML re-import and no disk re-parsing: the vector is rebuilt server-side from
the metadata columns plus the already-imported `labeling.spl_sections` rows. The
expression itself lives in `fts_vector.py`, shared with the post-import refresh
in db_07 so the two can never disagree.

Safe to re-run -- it only touches rows whose vector is NULL.

Usage:
  python backend/database/scripts/db_10_populate_full_search_vector.py [--batch-size 2000]
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
sys.path.append(str(current_dir))

from pg_utils import PGUtils
from fts_vector import ensure_column, ensure_index, populate_full_search_vector


def run(batch_size=2000):
    start_time = time.time()
    print('=' * 70)
    print('Populating document-level `full_search_vector` in PostgreSQL')
    print('=' * 70)

    conn = PGUtils.get_connection(cursor_factory=None)
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            print("[1/4] Ensuring column 'full_search_vector' exists on 'labeling.sum_spl'...")
            ensure_column(cur)
    finally:
        conn.close()

    print('[2/4] Building vectors...')
    populated, skipped = populate_full_search_vector(batch_size=batch_size)

    # After the bulk write, not before: every vector inserted while the index
    # exists costs GIN maintenance, and building once over finished data is
    # cheaper than maintaining it row by row.
    print("[3/4] Ensuring GIN index 'idx_sum_spl_full_fts'...")
    index_start = time.time()
    conn = PGUtils.get_connection(cursor_factory=None)
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            ensure_index(cur)
            print(f'      Index ready in {time.time() - index_start:.2f}s.')

            print('[4/4] Verifying coverage...')
            cur.execute("""
                SELECT count(*) FILTER (WHERE full_search_vector IS NOT NULL), count(*)
                FROM labeling.sum_spl;
            """)
            populated_count, total_count = cur.fetchone()
    finally:
        conn.close()

    print(f'[SUCCESS] {populated_count:,}/{total_count:,} sum_spl rows carry a vector '
          f'({populated:,} written this run).')
    if skipped:
        print(f'[WARN] {len(skipped)} label(s) could not be vectorized: {", ".join(skipped[:10])}'
              + (' ...' if len(skipped) > 10 else ''))
        print('       Full-text search stays on the slower per-section path until every')
        print('       row has a vector. Re-run this script once the cause is resolved.')
    print(f'Total time elapsed: {time.time() - start_time:.2f}s.')

    return populated, skipped


def main():
    parser = argparse.ArgumentParser(
        description='Populate document-level full_search_vector in PostgreSQL'
    )
    parser.add_argument('--batch-size', type=int, default=2000,
                        help='Labels per UPDATE statement')
    args = parser.parse_args()
    run(batch_size=args.batch_size)


if __name__ == '__main__':
    main()
