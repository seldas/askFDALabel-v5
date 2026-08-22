"""
Facet counts for the results sidebar.

Counts used to be tallied in Python over whatever rows happened to be at hand --
an unordered `LIMIT 3000` sample on Postgres, and on Oracle the 50-row page the
user was looking at. Both are samples of a set that is routinely far larger, so
the numbers were wrong whenever it mattered and could even rise after narrowing
a filter, because the sample moved. Here the counts come from aggregates over
the whole matched set instead.

Two rules shape the SQL:

  * One definition table, two dialects. Every bucket in FACET_SCALARS carries
    its Postgres and Oracle predicate side by side, so a bucket cannot exist in
    one backend and quietly not the other.

  * One statement per backend. Each bucket is a branch of a UNION ALL over a
    materialized `matched` CTE, so the (potentially expensive) predicate is
    evaluated once no matter how many buckets there are. Results come back in
    long form -- (category, token, count) -- and are assembled in Python.

Marketing categories are matched at a delimiter boundary rather than as bare
substrings: "NDA" as a substring also matches every ANDA row. The old Python
tally avoided that with an if/elif chain, which had the side effect of making
the buckets mutually exclusive -- a label marketed under both an NDA and an
ANDA counted only once, under whichever the chain hit first. These buckets are
independent, so such a label now counts in both.

On Oracle, "one statement" used to mean one statement *per active category* --
a self-excluded widen recompiled and reran the entire search predicate (full-
text CONTAINS, MedDRA joins, candidate isolation) from scratch, once per
ticked filter, on top of the base pass. That is the expensive part, and it
does not change across those calls: the actual search criteria are the same
every time, only which facet's own filter is temporarily removed changes.

oracle_facet_sql_combined runs the search criteria exactly once, as a
MATERIALIZED CTE built from strip_all_categories(query) -- the "backbone":
the maximum set of cases the real search criteria can match, with every
sidebar-driven filter cleared -- every key of CATEGORY_CRITERION, which is
the list the panel actually renders, not just the ones with a facet bucket. Every facet's own predicate is then layered
back on as a cheap, alias-swapped branch against that already-materialized set
(compile_active_category_predicates in oracle_compiler.py), so ticking or
unticking a sidebar filter never re-touches the base table or full-text index
again -- it only changes which AND clauses a branch carries.
"""

import copy

# Multi-value columns are ';'-delimited in both backends.
_MAX_SPLIT_PARTS = 20

# (category, token, value, label, postgres_predicate, oracle_predicate)
#
# `value` is what the sidebar matches its quick-pick against, so it has to stay
# byte-identical to what the old Python tally emitted.
FACET_SCALARS = [
    ('labelingFormat', 'plr', 'plr', 'PLR Format',
     "doc_type ILIKE '%%plr%%'",
     "m.FORMAT_GROUP = 1"),
    ('labelingFormat', 'non_plr', 'non_plr', 'non-PLR Format',
     "doc_type ILIKE '%%non-plr%%'",
     "m.FORMAT_GROUP = 2"),
    ('labelingFormat', 'unclassified', 'unclassified', 'Unclassified / Other',
     "doc_type NOT ILIKE '%%plr%%'",
     "(m.FORMAT_GROUP IS NULL OR m.FORMAT_GROUP NOT IN (1, 2))"),

    ('applicationTypes', 'rld', 'RLD', 'Reference Listed Drug (RLD)',
     "coalesce(is_rld, 0) <> 0",
     "m.SPL_ID IN (SELECT rr.SPL_ID FROM druglabel.SUM_SPL_RLD rr)"),

    ('marketStatus', 'status_rx', 'Prescription', 'Prescription',
     "doc_type ILIKE '%%prescription%%'",
     "UPPER(m.DOCUMENT_TYPE) LIKE '%PRESCRIPTION%'"),
    ('marketStatus', 'status_otc', 'OTC', 'OTC',
     "doc_type ILIKE '%%otc%%'",
     "UPPER(m.DOCUMENT_TYPE) LIKE '%OTC%'"),
]

# Categories whose values are data rather than a fixed list. Ordered by count
# and truncated in Python, since the sidebar only ever shows a handful.
_GROUPED_CATEGORIES = ('routes', 'dosageForms', 'pharmClasses', 'applicationTypes', 'labelingTypes')

# DEA schedule is grouped too, but it is the one category that lives outside
# the label row: PROD_DEA is a separate per-product table, and the Postgres
# import derives no DEA data at all (the compiler warns rather than widening).
# So it is counted on Oracle only, and the Postgres payload has to keep
# omitting the key -- an empty list would tell the sidebar the category was
# counted and matched nothing, which is a different claim from "never counted"
# and the one that makes it hide options.
_ORACLE_ONLY_GROUPED_CATEGORIES = ('deaSchedule',)
_ORACLE_GROUPED_CATEGORIES = _GROUPED_CATEGORIES + _ORACLE_ONLY_GROUPED_CATEGORIES

_GROUPED_LIMIT = 30

# Which criterion a category is driven by, and the value field to blank when
# counting that category "as if it were not filtered". See strip_category.
CATEGORY_CRITERION = {
    'labelingTypes': ('labelingType', ('values',)),
    # The PLR / non-PLR radio lives on the same criterion as labelingTypes but
    # is its own sidebar category, driven by FORMAT_GROUP rather than
    # DOCUMENT_TYPE. It has to be listed separately, or strip_all_categories
    # leaves it in the backbone and every count in the panel -- including the
    # "All Formats" total -- collapses to the PLR-filtered subset.
    'labelingFormat': ('labelingType', ('plr', 'formatGroup')),
    'applicationTypes': ('applicationType', ('values', 'isRld')),
    'marketStatus': ('marketStatus', ('values', 'startDateMin', 'startDateMax')),
    'routes': ('route', ('values',)),
    'dosageForms': ('dosageForm', ('values',)),
    'pharmClasses': ('pharmClass', ('terms',)),
    'deaSchedule': ('deaSchedule', ('values',)),
}

# Every key of CATEGORY_CRITERION has to be listed in the frontend's
# FACET_FILTER_FIELDS (frontend/app/querybuilder/types.ts). That is what
# decides when the facet request is refetched at all; a filter stripped here
# but not there costs a pointless round trip, and one stripped there but not
# here returns different numbers than the panel is already showing.


# A field holding one of these means "not filtered". The format radio is
# always present on the criterion and reads 'all' when nothing is chosen, so a
# plain truthiness test would report the category as filtered the moment the
# criterion exists at all.
_UNSET_FIELD_VALUES = {'', 'all'}


def _field_is_set(value, field):
    v = value.get(field)
    if isinstance(v, str):
        return v.strip().lower() not in _UNSET_FIELD_VALUES
    return bool(v)


def active_categories(query):
    """
    The facet categories the query currently filters on.

    These are the ones that need a second, self-excluded pass: a category
    counted against its own filter reports 0 for every value the user did not
    tick, which is exactly the number that cannot help them decide.
    """
    out = []
    for category, (ctype, fields) in CATEGORY_CRITERION.items():
        for group in (query.get('groups') or []):
            for criterion in (group.get('criteria') or []):
                if criterion.get('type') != ctype:
                    continue
                value = criterion.get('value') or {}
                if any(_field_is_set(value, f) for f in fields):
                    out.append(category)
                    break
            if category in out:
                break
    return out


def strip_categories(query, categories):
    """A copy of `query` with every listed category's own filter cleared."""
    # Two categories can share a criterion type (labelingTypes and
    # labelingFormat both live on labelingType), so the fields are unioned per
    # type rather than assigned -- otherwise one category silently overwrites
    # the other's entry and its filter survives the strip.
    wanted = {}
    for c in categories:
        ctype, fields = CATEGORY_CRITERION[c]
        wanted.setdefault(ctype, set()).update(fields)
    stripped = copy.deepcopy(query)
    for group in (stripped.get('groups') or []):
        for criterion in (group.get('criteria') or []):
            fields = wanted.get(criterion.get('type'))
            if fields is None:
                continue
            value = criterion.get('value') or {}
            for field in fields:
                if isinstance(value.get(field), list):
                    value[field] = []
                elif isinstance(value.get(field), bool):
                    value[field] = False
                elif field in value:
                    value[field] = None
            criterion['value'] = value
    return stripped


def strip_category(query, category):
    """A copy of `query` with `category`'s own filter cleared."""
    return strip_categories(query, [category])


def strip_all_categories(query):
    """
    The "backbone" query: every facet-driven criterion cleared, leaving only
    the real search criteria (free text, MedDRA, product name, identifiers,
    ...). This is the widest matched set the current search criteria can
    produce -- see oracle_facet_sql_combined, which runs it exactly once and
    layers every facet's own predicate back on as a cheap SQL branch instead
    of recompiling and rerunning the whole query per active category.
    """
    return strip_categories(query, list(CATEGORY_CRITERION.keys()))


# ---------------------------------------------------------------------------
# SQL
# ---------------------------------------------------------------------------

def postgres_facet_sql(relational_where):
    """
    One statement, long-format rows: (cat, token, n).

    MATERIALIZED is not optional -- without it the planner inlines `matched`
    into all sixteen branches and re-runs the whole predicate for each.
    """

    branches = [
        f"SELECT '{cat}' AS cat, '{token}' AS token, count(*) AS n FROM matched WHERE {pg_pred}"
        for cat, token, _value, _label, pg_pred, _ora_pred in FACET_SCALARS
    ]

    for cat, column, upper in (
        ('routes', 'routes', True),
        ('dosageForms', 'dosage_forms', True),
        ('pharmClasses', 'epc', False),
        ('applicationTypes', 'market_categories', True),
        ('labelingTypes', 'doc_type', True),
    ):
        token_expr = 'upper(btrim(v))' if upper else 'btrim(v)'
        branches.append(
            f"SELECT '{cat}' AS cat, {token_expr} AS token, count(DISTINCT spl_id) AS n "
            f"FROM matched, unnest(string_to_array({column}, ';')) v "
            f"WHERE btrim(v) <> '' GROUP BY {token_expr}"
        )

    union_sql = '\nUNION ALL\n'.join(branches)
    return f"""
        WITH matched AS MATERIALIZED (
            SELECT s.spl_id, s.doc_type, s.market_categories, s.routes,
                   s.dosage_forms, s.epc, s.is_rld
            FROM labeling.sum_spl s
            WHERE {relational_where}
        )
        {union_sql}
    """


def _oracle_grouped_branch(category, scope, extra_sql):
    """One UNION ALL branch for a data-driven (non-scalar) facet category."""
    if category == 'routes':
        return (
            f"SELECT '{scope}' AS SCOPE, 'routes' AS CAT, "
            "UPPER(TRIM(r.ROUTE_SPL_ACCEPTABLE_TERM)) AS TOKEN, "
            "COUNT(DISTINCT m.SPL_ID) AS N "
            "FROM matched m "
            "JOIN druglabel.SUM_SPL_ROUTE r ON r.SPL_ID = m.SPL_ID "
            f"WHERE r.ROUTE_SPL_ACCEPTABLE_TERM IS NOT NULL{extra_sql} "
            "GROUP BY UPPER(TRIM(r.ROUTE_SPL_ACCEPTABLE_TERM))"
        )
    if category == 'dosageForms':
        return (
            f"SELECT '{scope}' AS SCOPE, 'dosageForms' AS CAT, "
            "UPPER(TRIM(d.PRODUCT_DOSAGE_FORM_TERM)) AS TOKEN, "
            "COUNT(DISTINCT m.SPL_ID) AS N "
            "FROM matched m "
            "JOIN druglabel.SUM_SPL_DOSAGEFORM d ON d.SPL_ID = m.SPL_ID "
            f"WHERE d.PRODUCT_DOSAGE_FORM_TERM IS NOT NULL{extra_sql} "
            "GROUP BY UPPER(TRIM(d.PRODUCT_DOSAGE_FORM_TERM))"
        )
    if category == 'pharmClasses':
        return (
            f"SELECT '{scope}' AS SCOPE, 'pharmClasses' AS CAT, "
            "TRIM(e.EPC) AS TOKEN, "
            "COUNT(DISTINCT m.SPL_ID) AS N "
            "FROM matched m "
            "JOIN druglabel.SUM_SPL_EPC e ON e.SPL_ID = m.SPL_ID "
            f"WHERE e.EPC IS NOT NULL{extra_sql} "
            "GROUP BY TRIM(e.EPC)"
        )
    if category == 'applicationTypes':
        return (
            f"SELECT '{scope}' AS SCOPE, 'applicationTypes' AS CAT, "
            "UPPER(TRIM(mc.CATEGORY_SPL_ACCEPTABLE_TERM)) AS TOKEN, "
            "COUNT(DISTINCT m.SPL_ID) AS N "
            "FROM matched m "
            "JOIN druglabel.SUM_SPL_MKT_CAT mc ON mc.SPL_ID = m.SPL_ID "
            f"WHERE mc.CATEGORY_SPL_ACCEPTABLE_TERM IS NOT NULL{extra_sql} "
            "GROUP BY UPPER(TRIM(mc.CATEGORY_SPL_ACCEPTABLE_TERM))"
        )
    if category == 'labelingTypes':
        return (
            f"SELECT '{scope}' AS SCOPE, 'labelingTypes' AS CAT, "
            "UPPER(TRIM(m.DOCUMENT_TYPE)) AS TOKEN, "
            "COUNT(DISTINCT m.SPL_ID) AS N "
            "FROM matched m "
            f"WHERE m.DOCUMENT_TYPE IS NOT NULL{extra_sql} "
            "GROUP BY UPPER(TRIM(m.DOCUMENT_TYPE))"
        )
    if category == 'deaSchedule':
        # The only branch that leaves `matched`: the schedule lives on
        # PROD_DEA, one row per product, so a label with several controlled
        # products would count once per product without the DISTINCT. The
        # sidebar sends the SPL acceptable term ("CII"), which is what
        # NCIT_DEA_NAME carries, so grouping on it needs no join to
        # DEA_SCHEDULE and lands on the same token _compile_dea_schedule
        # matches.
        return (
            f"SELECT '{scope}' AS SCOPE, 'deaSchedule' AS CAT, "
            "UPPER(TRIM(dea.NCIT_DEA_NAME)) AS TOKEN, "
            "COUNT(DISTINCT m.SPL_ID) AS N "
            "FROM matched m "
            "JOIN druglabel.PROD_DEA dea ON dea.SPL_ID = m.SPL_ID "
            f"WHERE dea.NCIT_DEA_NAME IS NOT NULL{extra_sql} "
            "GROUP BY UPPER(TRIM(dea.NCIT_DEA_NAME))"
        )
    raise ValueError(f'Not a grouped category: {category!r}')


def oracle_facet_sql_combined(text_cte_sql, backbone_where_sql, base_table, active_predicates):
    """
    The whole Oracle facet payload -- base counts plus every active category's
    self-excluded ("what if I widened just this one") counts -- in one
    statement, one round trip.
    """
    def and_others(exclude):
        parts = [p for cat, p in active_predicates.items() if cat != exclude and p]
        return f" AND {' AND '.join(parts)}" if parts else ''

    base_extra = and_others(exclude=None)  # no category excluded -> apply all
    branches = [
        f"SELECT 'base' AS SCOPE, '{cat}' AS CAT, '{token}' AS TOKEN, COUNT(*) AS N "
        f"FROM matched m WHERE {ora_pred}{base_extra}"
        for cat, token, _value, _label, _pg_pred, ora_pred in FACET_SCALARS
    ]
    for grouped_cat in _ORACLE_GROUPED_CATEGORIES:
        branches.append(_oracle_grouped_branch(grouped_cat, 'base', base_extra))

    for category in active_predicates:
        extra = and_others(exclude=category)
        scope = f'w:{category}'
        if category in _ORACLE_GROUPED_CATEGORIES:
            branches.append(_oracle_grouped_branch(category, scope, extra))
        else:
            for cat, token, _value, _label, _pg_pred, ora_pred in FACET_SCALARS:
                if cat != category:
                    continue
                branches.append(
                    f"SELECT '{scope}' AS SCOPE, '{cat}' AS CAT, '{token}' AS TOKEN, COUNT(*) AS N "
                    f"FROM matched m WHERE {ora_pred}{extra}"
                )

    union_sql = '\nUNION ALL\n'.join(branches)
    format_group_col = "s.FORMAT_GROUP" if str(base_table).lower().endswith("dgv_sum_rx_spl") else "NULL AS FORMAT_GROUP"
    return f"""
        WITH {text_cte_sql}matched AS (
            SELECT /*+ MATERIALIZE */ s.SPL_ID, s.DOCUMENT_TYPE, s.MARKET_CATEGORIES, s.EPC, s.DOSAGE_FORMS, s.ROUTES_OF_ADMINISTRATION AS ROUTES, s.APPR_NUM, {format_group_col}
            FROM {base_table} s
            WHERE {backbone_where_sql}
        )
        {union_sql}
    """.strip()


# ---------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------

def rows_to_facets(rows, grouped_categories=_GROUPED_CATEGORIES):
    """
    Long-format (cat, token, n) rows -> the payload the sidebar reads.

    Every scalar bucket is emitted even at zero, because the sidebar needs the
    difference between "this category counted nothing" and "this category was
    never computed" -- the latter is what it uses to decide whether hiding
    zero-count options is meaningful at all.

    `grouped_categories` is that same distinction for the grouped half, and is
    why it is a parameter rather than the module constant: the caller states
    which categories its statement actually asked about, so a backend that
    cannot count one of them (deaSchedule on Postgres) leaves the key out
    instead of publishing a zeroed bucket.
    """
    counts = {}
    grouped = {cat: {} for cat in grouped_categories}

    for row in rows or []:
        cat, token, n = (row[0], row[1], row[2]) if not isinstance(row, dict) else (
            row.get('cat'), row.get('token'), row.get('n')
        )
        if cat is None or token is None:
            continue
        n = int(n or 0)
        if cat in grouped:
            token = str(token).strip()
            if token:
                grouped[cat][token] = grouped[cat].get(token, 0) + n
        else:
            counts[(cat, token)] = n

    facets = {}
    for cat, token, value, label, _pg, _ora in FACET_SCALARS:
        facets.setdefault(cat, []).append({
            'value': value,
            'label': label,
            'count': counts.get((cat, token), 0),
        })

    for cat in grouped_categories:
        ordered = sorted(grouped[cat].items(), key=lambda kv: kv[1], reverse=True)[:_GROUPED_LIMIT]
        facets[cat] = [{'value': k, 'label': k, 'count': v} for k, v in ordered]

    return facets


def rows_to_scoped_facets(rows):
    """
    Splits the long-format (scope, cat, token, n) rows from
    oracle_facet_sql_combined by scope, then runs each scope's rows through
    rows_to_facets independently.

    Returns {'base': {...facets...}, 'w:<category>': {...facets...}, ...}.
    """
    by_scope = {}
    for row in rows or []:
        if isinstance(row, dict):
            scope = row.get('scope') or row.get('SCOPE')
            cat = row.get('cat') or row.get('CAT')
            token = row.get('token') or row.get('TOKEN')
            n = row.get('n') or row.get('N')
        else:
            scope, cat, token, n = row[0], row[1], row[2], row[3]
        if scope is None:
            continue
        by_scope.setdefault(scope, []).append((cat, token, n))

    return {
        scope: rows_to_facets(scoped_rows, grouped_categories=_ORACLE_GROUPED_CATEGORIES)
        for scope, scoped_rows in by_scope.items()
    }
