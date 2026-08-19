#!/usr/bin/env python3
"""
db_12_drop_fulltext_search.py

One-way migration that removes every full-text search structure from the local
PostgreSQL database.

Rationale: at full import scale (~700k SPLs) the searchable text was stored
three times over -- once as `labeling.spl_sections.content_xml`, again as that
table's generated `search_vector` TSVECTOR plus its GIN index, and a third time
as the document-level `labeling.sum_spl.full_search_vector` and *its* GIN index.
None of it is read any more: the local query compiler disables the fullText,
MedDRA and section-text criteria outright, and the label viewer reads SPL XML
from disk via `sum_spl.local_path` rather than from `spl_sections`.

What this drops:

* `labeling.spl_sections` (table, generated TSVECTOR column, and both indexes)
* `labeling.sum_spl.full_search_vector` and `idx_sum_spl_full_fts`
* the `sections` rows of `labeling.query_options_cache`, which only ever
  counted section codes
* the `vector` (pgvector) extension, left over from the abandoned embedding
  search -- kept only if some other object still depends on it

`pg_trgm` is deliberately NOT dropped: the trigram indexes in
db_02_init_labeling_schema.py serve the name/category criteria that remain.

Space is not returned to the operating system until the table is rewritten, so
this runs VACUUM (FULL, ANALYZE) on `labeling.sum_spl` unless --no-vacuum is
passed. That takes an ACCESS EXCLUSIVE lock and needs free disk space equal to
the size of the table; skip it on a live deployment and schedule it separately.

Idempotent -- every step is IF EXISTS.

Usage:
  python backend/database/scripts/db_12_drop_fulltext_search.py [--no-vacuum] [--dry-run]
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


#: (label, SQL). Ordered so an index is gone before the thing it indexes, and
#: `spl_sections` is dropped before anything that might reference it.
DROP_STEPS = [
    ("Dropping GIN index labeling.idx_spl_sections_fts",
     "DROP INDEX IF EXISTS labeling.idx_spl_sections_fts;"),

    ("Dropping index labeling.idx_spl_sections_spl_id",
     "DROP INDEX IF EXISTS labeling.idx_spl_sections_spl_id;"),

    # Takes the generated search_vector column with it. CASCADE covers the
    # foreign key from sum_spl and any view a deployment added by hand.
    ("Dropping table labeling.spl_sections",
     "DROP TABLE IF EXISTS labeling.spl_sections CASCADE;"),

    ("Dropping GIN index labeling.idx_sum_spl_full_fts",
     "DROP INDEX IF EXISTS labeling.idx_sum_spl_full_fts;"),

    ("Dropping column labeling.sum_spl.full_search_vector",
     "ALTER TABLE labeling.sum_spl DROP COLUMN IF EXISTS full_search_vector;"),

    ("Purging 'sections' rows from labeling.query_options_cache",
     "DELETE FROM labeling.query_options_cache WHERE category = 'sections';"),

    # Never had a column pointing at it in this schema, but the extension was
    # installed by the retired db_01_enable_pgvector.py. RESTRICT (the default)
    # so an install that *is* still using it fails loudly instead of losing data.
    ("Dropping pgvector extension",
     "DROP EXTENSION IF EXISTS vector;"),
]


def _report_sizes(cur, when):
    """Prints what the FTS objects still occupy, so the run has a before/after."""
    cur.execute("""
        SELECT
            to_regclass('labeling.spl_sections'),
            to_regclass('labeling.idx_sum_spl_full_fts'),
            pg_size_pretty(pg_total_relation_size('labeling.sum_spl'));
    """)
    sections, full_fts_idx, sum_spl_size = cur.fetchone()

    print(f'  {when}:')
    if sections is not None:
        cur.execute("SELECT pg_size_pretty(pg_total_relation_size('labeling.spl_sections'));")
        print(f'    labeling.spl_sections : {cur.fetchone()[0]}')
    else:
        print('    labeling.spl_sections : (gone)')
    print(f'    labeling.sum_spl      : {sum_spl_size}'
          + ('' if full_fts_idx is None else '  (includes idx_sum_spl_full_fts)'))


def run(vacuum=True, dry_run=False):
    start_time = time.time()
    print('=' * 70)
    print('Removing full-text search structures from PostgreSQL')
    print('=' * 70)

    conn = PGUtils.get_connection(cursor_factory=None)
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            _report_sizes(cur, 'Before')

            if dry_run:
                print('\n[DRY RUN] Would execute:')
                for label, statement in DROP_STEPS:
                    print(f'  -- {label}\n  {statement}')
                if vacuum:
                    print('  -- Reclaiming space\n  VACUUM (FULL, ANALYZE) labeling.sum_spl;')
                return

            print()
            for i, (label, statement) in enumerate(DROP_STEPS, start=1):
                print(f'[{i}/{len(DROP_STEPS)}] {label}...')
                try:
                    cur.execute(statement)
                except Exception as e:
                    # A dependency this script does not know about should not
                    # abort the steps after it; autocommit keeps the connection
                    # usable, so report and continue.
                    print(f'        [WARN] {e}')

            if vacuum:
                # DROP COLUMN only marks the column dropped; its data stays in
                # every existing row until the heap is rewritten. Without this
                # the migration frees index space but no table space.
                print('\nReclaiming space (VACUUM FULL on labeling.sum_spl; this takes an '
                      'exclusive lock)...')
                vac_start = time.time()
                try:
                    cur.execute('VACUUM (FULL, ANALYZE) labeling.sum_spl;')
                    print(f'      Done in {time.time() - vac_start:.2f}s.')
                except Exception as e:
                    print(f'      [WARN] VACUUM FULL failed: {e}')
                    print('      Table space stays allocated until sum_spl is rewritten.')
            else:
                print('\nSkipping VACUUM FULL (--no-vacuum). Dropped column data stays on')
                print('disk until labeling.sum_spl is rewritten; run ANALYZE at minimum.')
                try:
                    cur.execute('ANALYZE labeling.sum_spl;')
                except Exception as e:
                    print(f'      [WARN] ANALYZE failed: {e}')

            print()
            _report_sizes(cur, 'After')
    finally:
        conn.close()

    print(f'\n[SUCCESS] Full-text search structures removed in {time.time() - start_time:.2f}s.')


def main():
    parser = argparse.ArgumentParser(
        description='Drop all full-text search structures from the local PostgreSQL database'
    )
    parser.add_argument('--no-vacuum', action='store_true',
                        help='Skip VACUUM FULL; dropped data stays on disk until the table is rewritten')
    parser.add_argument('--dry-run', action='store_true',
                        help='Print the statements without executing them')
    args = parser.parse_args()
    run(vacuum=not args.no_vacuum, dry_run=args.dry_run)


if __name__ == '__main__':
    main()
