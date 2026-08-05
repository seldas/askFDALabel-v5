# Enabling document-level full-text search (`full_search_vector`)

Unscoped full-text search can run one indexed probe per label against
`labeling.sum_spl.full_search_vector` instead of scanning and de-duplicating
every section row of every candidate. This document is what to do in a new or
existing environment to turn that on.

It is off until the column is fully populated. Nothing breaks in the meantime —
search silently uses the older `labeling.spl_sections` path, which is correct,
just slower.

## Why it is all-or-nothing

The backend decides once per process which path to use, in
`labelquery/blueprint.py::_capabilities()`:

```sql
SELECT 1 FROM labeling.sum_spl WHERE full_search_vector IS NULL LIMIT 1
```

No rows back means every label has a vector, and the fast path turns on. **One
NULL row anywhere in `sum_spl` keeps the whole deployment on the slow path.**

That is deliberate, not a limitation to work around. A per-row fallback
(`... OR full_search_vector IS NULL AND EXISTS (...)`) cannot be indexed — GIN
does not index NULLs — so it would force a sequential scan of `sum_spl` on every
search and defeat the index entirely. The two paths also search different text:
the document vector additionally covers product, generic, ingredient and
manufacturer names. Mixing them per row would apply different matching rules to
different labels inside a single query.

The result is cached for the life of the process, so **restart the app after
populating.**

---

## Which path applies to you

| Situation | Do this |
|---|---|
| Brand-new database, labels not imported yet | [Path A](#path-a-new-database) — nothing extra |
| Database already imported, never had this column | [Path B](#path-b-existing-database) |
| Already ran an earlier version of `db_10` | [Path C](#path-c-rebuilding-stale-vectors) — **reset first** |

Prerequisites for all paths: repo-root `.env` must exist (the backend raises at
import time without it) and the venv must be active. Run from the repo root.

---

## Path A: new database

No extra step. `db_02_init_labeling_schema.py` creates the column and its GIN
index, and `db_07_import_labels.py` calls `refresh_full_search_vector()` at the
end of the import.

```bash
python backend/database/scripts/db_02_init_labeling_schema.py
python backend/database/scripts/db_07_import_labels.py --force --skip-unpack
```

Then jump to [Verify](#verify).

## Path B: existing database

The column is added by `db_02` (idempotent, safe to re-run), then populated
in-place from the already-imported section rows. No XML re-import, no disk
re-parsing.

```bash
python backend/database/scripts/db_02_init_labeling_schema.py
python backend/database/scripts/db_10_populate_full_search_vector.py
```

`db_10` only touches rows whose vector is NULL, so it is safe to re-run and safe
to interrupt — rerunning resumes where it stopped. On a large corpus it is the
long step; `--batch-size` (default 2000) trades transaction size against memory.

To speed up the index build, raise `maintenance_work_mem` for the session first:

```bash
psql "$DATABASE_URL" -c "SET maintenance_work_mem = '1GB';"
```

## Path C: rebuilding stale vectors

**This applies if you ran `db_10` before commit `2a92d7f`.** Those vectors were
built from raw `content_xml`, including markup tokens as lexemes. The current
expression strips tags before vectorizing.

`db_10` only fills NULLs, so it will not replace them. Reset first:

```bash
psql "$DATABASE_URL" -c "UPDATE labeling.sum_spl SET full_search_vector = NULL;"
```

```bash
python backend/database/scripts/db_10_populate_full_search_vector.py
```

Search falls back to the per-section path while the column is empty, so this is
safe to do on a running system — queries stay correct, just slower until it
finishes and the app is restarted.

---

## Verify

**1. Every row has a vector.** `missing` must be `0`, or the fast path stays off:

```sql
SELECT count(*) FILTER (WHERE full_search_vector IS NULL) AS missing,
       count(*) AS total
FROM labeling.sum_spl;
```

**2. Restart the app**, so `_capabilities()` re-probes.

**3. The planner actually uses the index.** Look for `Bitmap Index Scan on
idx_sum_spl_full_fts` — a `Seq Scan` means something is still wrong:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT s.spl_id
FROM labeling.sum_spl s
WHERE s.is_latest = TRUE
  AND s.full_search_vector @@ phraseto_tsquery('english', 'hepatic failure');
```

**4. Spot-check results.** Run the same unscoped full-text query through the UI
before and after and confirm the result *sets* match, not just the timings. A
section-scoped search ("Warnings contains X") is expected to be unchanged — it
cannot use this column, because the scope is the section row.

---

## Ongoing imports

Nothing manual. `db_07_import_labels.py` and `import_archive_labels.py` both
call `refresh_full_search_vector()` after a sync, which fills in whatever is
missing. Re-imported labels have their vector set to NULL by the upsert so it
gets rebuilt from the new text rather than kept stale.

The consequence worth knowing: **an import leaves the deployment on the slow
path until that refresh finishes and the app is restarted**, because new rows
are briefly NULL. That is a visible latency change, not an outage.

---

## Troubleshooting

**Search is still slow after populating.** Almost always a NULL row or a stale
process. Re-run the query in step 1, then confirm the app was restarted.

**`db_10` reports skipped labels.** A tsvector caps at 1MB. `db_10` retries an
oversized label against progressively smaller slices of its body
(`BODY_CHAR_LIMITS` in `backend/database/scripts/fts_vector.py`), ending at a
metadata-only vector, so a genuine skip means something else failed — the
message names the `spl_id`. Those rows stay NULL and hold the whole deployment
on the slow path, so they need resolving.

**Disk grew more than expected.** Expected. This stores the corpus text a second
time — roughly the same order as the existing `spl_sections.search_vector`, less
the markup lexemes now stripped, plus a second GIN index.

## Rolling back

Safe and immediate — dropping the column sends every search back to the
per-section path:

```sql
DROP INDEX IF EXISTS labeling.idx_sum_spl_full_fts;
ALTER TABLE labeling.sum_spl DROP COLUMN IF EXISTS full_search_vector;
```

Restart the app afterwards. The capability probe treats a missing column as
"not available", so no code change is needed to run without it. To stop it being
recreated on the next run, remove the two `full_search_vector` statements in
`db_02_init_labeling_schema.py`.

---

## Status

The compiler changes were verified by exercising `compile_where` directly across
single-group, multi-group and virtual-section cases. **The SQL in this migration
has not yet been run against a live PostgreSQL instance** — the first run of
`db_10` on real data is still unproven. Check step 3 of
[Verify](#verify) rather than assuming.
