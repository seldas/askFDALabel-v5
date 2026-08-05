"""
Canonical definition of the document-level ``labeling.sum_spl.full_search_vector``.

One label's searchable text lives in two places: a handful of metadata columns on
``sum_spl`` and N rows of ``spl_sections.content_xml``. ``full_search_vector``
folds both into a single TSVECTOR so a full-text criterion is one indexed ``@@``
probe per label instead of a scan-and-dedup over the section table.

Every writer of that column goes through this module, so the fast path and the
per-section fallback in ``labelquery.compiler`` cannot drift apart.

Two properties of the expression are load-bearing:

* **XML markup is stripped before vectorizing.** ``content_xml`` is markup, not
  prose; tag and attribute tokens would otherwise become lexemes. Removing them
  shrinks the vector (and the GIN index) substantially, and it *fixes* phrase
  recall: SPL text is constantly interleaved with inline tags, so "warfarin
  sodium" split by a ``<content>`` element is not adjacent in the raw-XML vector
  but is adjacent here.
* **Positions are kept.** FDALabel's default search mode compiles to
  ``phraseto_tsquery`` (see ``labelquery.compiler._tsquery_sql``), which matches
  on lexeme adjacency. Calling ``strip()`` would shrink vectors nicely and make
  every default search silently return nothing.

A TSVECTOR caps at 1MB. Stripping markup puts all but the most extreme labels
well under it; :func:`populate_full_search_vector` handles the remainder by
retrying the row against progressively smaller slices of its body text.
"""

# A section boundary has to consume a token position, or a phrase query could
# match across the seam between the end of one section and the start of the next
# -- something the per-section vectors it replaces can never do. The token is
# deliberately not a word so it cannot collide with a real search term.
SECTION_BREAK = 'zzsplsectionbreak'

# Body-size ladder, in characters of stripped section text, tried in order when a
# label overflows the 1MB TSVECTOR limit. ``None`` means the whole body.
BODY_CHAR_LIMITS = (None, 2_000_000, 500_000, 0)

_METADATA_TSVECTOR = """
    to_tsvector('english',
        coalesce(s.product_names, '') || ' ' ||
        coalesce(s.generic_names, '') || ' ' ||
        coalesce(s.active_ingredients, '') || ' ' ||
        coalesce(s.manufacturer, '')
    )
"""


def full_search_vector_expr(body_char_limit=None):
    """
    The SQL expression computing ``full_search_vector`` for row ``s``.

    ``body_char_limit`` truncates the aggregated section text; pass 0 for a
    metadata-only vector. Only the overflow retry path passes either.
    """
    metadata = _METADATA_TSVECTOR.strip()
    if body_char_limit == 0:
        return metadata

    stripped = "regexp_replace(coalesce(sec.content_xml, ''), '<[^>]*>', ' ', 'g')"
    aggregated = f"string_agg({stripped}, ' {SECTION_BREAK} ' ORDER BY sec.id)"
    if body_char_limit is not None:
        aggregated = f'left({aggregated}, {int(body_char_limit)})'

    return f"""
    {metadata} || coalesce((
        SELECT to_tsvector('english', {aggregated})
        FROM labeling.spl_sections sec
        WHERE sec.spl_id = s.spl_id
    ), to_tsvector('english', ''))
    """.strip()


def _update_sql(body_char_limit=None):
    return f"""
        UPDATE labeling.sum_spl s
        SET full_search_vector = {full_search_vector_expr(body_char_limit)}
        WHERE s.spl_id = ANY(%s);
    """


def ensure_column(cur):
    """Adds the column if an older database predates it. Idempotent."""
    cur.execute(
        'ALTER TABLE labeling.sum_spl '
        'ADD COLUMN IF NOT EXISTS full_search_vector TSVECTOR;'
    )


def ensure_index(cur):
    """Adds the GIN index backing ``full_search_vector @@ ...``. Idempotent."""
    cur.execute(
        'CREATE INDEX IF NOT EXISTS idx_sum_spl_full_fts '
        'ON labeling.sum_spl USING GIN (full_search_vector);'
    )


def _populate_one(cur, spl_id, verbose=True):
    """
    Rebuilds a single label's vector, shrinking its body until it fits.

    Returns the character limit that succeeded, or None if even the
    metadata-only vector failed.
    """
    last_error = None
    for limit in BODY_CHAR_LIMITS:
        try:
            cur.execute(_update_sql(limit), ([spl_id],))
            if limit is not None and verbose:
                scope = 'metadata only' if limit == 0 else f'first {limit:,} chars of body'
                print(f'      [WARN] {spl_id} exceeded the TSVECTOR limit; indexed {scope}.')
            return limit
        except Exception as e:
            last_error = e
    if verbose:
        print(f'      [ERROR] {spl_id} could not be vectorized at all: {last_error}')
    return None


def populate_full_search_vector(batch_size=2000, verbose=True, analyze=True):
    """
    Fills ``full_search_vector`` for every ``sum_spl`` row still missing one.

    Work is claimed through a temp table rather than by holding every pending
    spl_id in memory, and each batch is its own transaction: a label whose text
    overflows the TSVECTOR limit is retried row by row against
    :data:`BODY_CHAR_LIMITS` instead of taking the other rows in its batch down
    with it.

    Returns ``(populated, skipped)``.
    """
    from pg_utils import PGUtils

    # A tuple cursor, not the PGUtils default RealDictCursor: this reads a single
    # unnamed column and positional access is what the loop below wants.
    conn = PGUtils.get_connection(cursor_factory=None)
    conn.autocommit = True

    populated = 0
    skipped = []

    try:
        with conn.cursor() as cur:
            ensure_column(cur)

            cur.execute("""
                CREATE TEMP TABLE fsv_worklist AS
                SELECT spl_id FROM labeling.sum_spl WHERE full_search_vector IS NULL;
                """)
            cur.execute('ALTER TABLE fsv_worklist ADD PRIMARY KEY (spl_id);')
            cur.execute('SELECT COUNT(*) FROM fsv_worklist;')
            total = cur.fetchone()[0]

            if not total:
                if verbose:
                    print('      Every sum_spl row already has a full_search_vector.')
                return 0, []

            if verbose:
                print(f'      {total:,} labels need a vector; batches of {batch_size:,}.')

            while True:
                cur.execute('SELECT spl_id FROM fsv_worklist LIMIT %s;', (batch_size,))
                batch = [row[0] for row in cur.fetchall()]
                if not batch:
                    break

                try:
                    cur.execute(_update_sql(), (batch,))
                    populated += len(batch)
                except Exception as e:
                    if verbose:
                        print(f'      [WARN] Batch failed ({e}); retrying its {len(batch)} labels individually.')
                    for spl_id in batch:
                        if _populate_one(cur, spl_id, verbose) is None:
                            skipped.append(spl_id)
                        else:
                            populated += 1

                cur.execute('DELETE FROM fsv_worklist WHERE spl_id = ANY(%s);', (batch,))
                if verbose:
                    done = populated + len(skipped)
                    print(f'      {done:,}/{total:,} ({done / total * 100:.1f}%)')

            cur.execute('DROP TABLE IF EXISTS fsv_worklist;')

            if analyze:
                # The planner has no statistics for a column it has never seen,
                # and without them it will not cost the GIN scan correctly.
                if verbose:
                    print('      Analyzing labeling.sum_spl...')
                cur.execute('ANALYZE labeling.sum_spl;')
    finally:
        conn.close()

    return populated, skipped
