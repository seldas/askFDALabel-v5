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
"""

import copy

# Multi-value columns are ';'-delimited in both backends.
_MAX_SPLIT_PARTS = 20

# (category, token, value, label, postgres_predicate, oracle_predicate)
#
# `value` is what the sidebar matches its quick-pick against, so it has to stay
# byte-identical to what the old Python tally emitted.
FACET_SCALARS = [
    ('labelingTypes', 'human_rx', '%HUMAN PRESCRIPTION%', 'Human Rx',
     "doc_type ILIKE '%%human prescription%%'",
     "UPPER(m.DOCUMENT_TYPE) LIKE '%HUMAN PRESCRIPTION%'"),
    ('labelingTypes', 'human_otc', '%HUMAN OTC%', 'Human OTC',
     "doc_type ILIKE '%%human otc%%'",
     "UPPER(m.DOCUMENT_TYPE) LIKE '%HUMAN OTC%'"),
    ('labelingTypes', 'animal_rx', '%ANIMAL%PRESCRIPTION%', 'Animal Rx',
     "doc_type ILIKE '%%animal%%' AND doc_type ILIKE '%%prescription%%'",
     "UPPER(m.DOCUMENT_TYPE) LIKE '%ANIMAL%' AND UPPER(m.DOCUMENT_TYPE) LIKE '%PRESCRIPTION%'"),
    ('labelingTypes', 'animal_otc', '%ANIMAL%OTC%', 'Animal OTC',
     "doc_type ILIKE '%%animal%%' AND doc_type ILIKE '%%otc%%'",
     "UPPER(m.DOCUMENT_TYPE) LIKE '%ANIMAL%' AND UPPER(m.DOCUMENT_TYPE) LIKE '%OTC%'"),
    ('labelingTypes', 'vaccine', '%VACCINE%', 'Vaccine',
     "doc_type ILIKE '%%vaccine%%'",
     "UPPER(m.DOCUMENT_TYPE) LIKE '%VACCINE%'"),

    ('applicationTypes', 'anda', 'ANDA', 'ANDA',
     "market_categories ~* '(^|;)[[:space:]]*ANDA'",
     "REGEXP_LIKE(m.MARKET_CATEGORIES, '(^|;)[[:space:]]*ANDA', 'i')"),
    ('applicationTypes', 'nda', 'NDA', 'NDA',
     "market_categories ~* '(^|;)[[:space:]]*NDA'",
     "REGEXP_LIKE(m.MARKET_CATEGORIES, '(^|;)[[:space:]]*NDA', 'i')"),
    ('applicationTypes', 'bla', 'BLA', 'BLA',
     "market_categories ~* '(^|;)[[:space:]]*BLA'",
     "REGEXP_LIKE(m.MARKET_CATEGORIES, '(^|;)[[:space:]]*BLA', 'i')"),
    ('applicationTypes', 'monograph', '%OTC monograph%', 'OTC Monograph Drug',
     "market_categories ILIKE '%%monograph%%'",
     "UPPER(m.MARKET_CATEGORIES) LIKE '%MONOGRAPH%'"),
    ('applicationTypes', 'rld', 'RLD', 'Reference Listed Drug (RLD)',
     "coalesce(is_rld, 0) <> 0",
     "EXISTS (SELECT 1 FROM druglabel.SUM_SPL_RLD_RS rr WHERE rr.SPL_ID = m.SPL_ID "
     "AND rr.REFERENCE_DRUG IN ('Y', 'Yes', '1'))"),
    ('applicationTypes', 'rs', 'RS', 'Reference Standard (RS)',
     "coalesce(is_rs, 0) <> 0",
     "EXISTS (SELECT 1 FROM druglabel.SUM_SPL_RLD_RS rr WHERE rr.SPL_ID = m.SPL_ID "
     "AND rr.REFERENCE_STANDARD IN ('Y', 'Yes', '1'))"),

    ('marketStatus', 'status_rx', 'Prescription', 'Prescription',
     "doc_type ILIKE '%%prescription%%'",
     "UPPER(m.DOCUMENT_TYPE) LIKE '%PRESCRIPTION%'"),
    ('marketStatus', 'status_otc', 'OTC', 'OTC',
     "doc_type ILIKE '%%otc%%'",
     "UPPER(m.DOCUMENT_TYPE) LIKE '%OTC%'"),
]

# Categories whose values are data rather than a fixed list. Ordered by count
# and truncated in Python, since the sidebar only ever shows a handful.
_GROUPED_CATEGORIES = ('routes', 'dosageForms', 'pharmClasses')
_GROUPED_LIMIT = 30

# Which criterion a category is driven by, and the value field to blank when
# counting that category "as if it were not filtered". See strip_category.
CATEGORY_CRITERION = {
    'labelingTypes': ('labelingType', ('values',)),
    'applicationTypes': ('applicationType', ('values', 'isRld', 'isRs', 'isRldRs')),
    'marketStatus': ('marketStatus', ('values',)),
    'routes': ('route', ('values',)),
    'dosageForms': ('dosageForm', ('values',)),
    'pharmClasses': ('pharmClass', ('terms',)),
}


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
                if any(value.get(f) for f in fields):
                    out.append(category)
                    break
            if category in out:
                break
    return out


def strip_category(query, category):
    """A copy of `query` with `category`'s own filter cleared."""
    ctype, fields = CATEGORY_CRITERION[category]
    stripped = copy.deepcopy(query)
    for group in (stripped.get('groups') or []):
        for criterion in (group.get('criteria') or []):
            if criterion.get('type') != ctype:
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


# ---------------------------------------------------------------------------
# SQL
# ---------------------------------------------------------------------------

def postgres_facet_sql(relational_where, section_where):
    """
    One statement, long-format rows: (cat, token, n).

    MATERIALIZED is not optional -- without it the planner inlines `matched`
    into all sixteen branches and re-runs the whole predicate for each.
    """
    sec_join = ''
    if section_where:
        sec_join = (
            'INNER JOIN (SELECT DISTINCT sec.spl_id FROM labeling.spl_sections sec '
            f'WHERE {section_where}) sc ON sc.spl_id = s.spl_id'
        )

    branches = [
        f"SELECT '{cat}' AS cat, '{token}' AS token, count(*) AS n FROM matched WHERE {pg_pred}"
        for cat, token, _value, _label, pg_pred, _ora_pred in FACET_SCALARS
    ]

    for cat, column, upper in (
        ('routes', 'routes', True),
        ('dosageForms', 'dosage_forms', True),
        ('pharmClasses', 'epc', False),
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
                   s.dosage_forms, s.epc, s.is_rld, s.is_rs
            FROM labeling.sum_spl s
            {sec_join}
            WHERE {relational_where}
        )
        {union_sql}
    """


def oracle_facet_sql(text_cte_sql, where_sql, base_table):
    """
    The Oracle counterpart. Routes and dosage forms come from the normalized
    detail tables, which is both cheaper and more faithful than splitting the
    delimited rollup columns. EPC has no such table -- SUM_SPL_EPC carries the
    same concatenated string -- so it is split with REGEXP_SUBSTR against a
    generated row source, bounded at _MAX_SPLIT_PARTS classes per label.
    """
    branches = [
        f"SELECT '{cat}' AS CAT, '{token}' AS TOKEN, COUNT(*) AS N FROM matched m WHERE {ora_pred}"
        for cat, token, _value, _label, _pg_pred, ora_pred in FACET_SCALARS
    ]

    branches.append(
        "SELECT 'routes' AS CAT, UPPER(r.ROUTE_SPL_ACCEPTABLE_TERM) AS TOKEN, "
        "COUNT(DISTINCT m.SPL_ID) AS N "
        'FROM matched m JOIN druglabel.SUM_SPL_ROUTE r ON r.SPL_ID = m.SPL_ID '
        'WHERE r.ROUTE_SPL_ACCEPTABLE_TERM IS NOT NULL '
        'GROUP BY UPPER(r.ROUTE_SPL_ACCEPTABLE_TERM)'
    )
    branches.append(
        "SELECT 'dosageForms' AS CAT, UPPER(df.PRODUCT_DOSAGE_FORM_TERM) AS TOKEN, "
        "COUNT(DISTINCT m.SPL_ID) AS N "
        'FROM matched m JOIN druglabel.SUM_SPL_DOSAGEFORM df ON df.SPL_ID = m.SPL_ID '
        'WHERE df.PRODUCT_DOSAGE_FORM_TERM IS NOT NULL '
        'GROUP BY UPPER(df.PRODUCT_DOSAGE_FORM_TERM)'
    )
    branches.append(
        "SELECT 'pharmClasses' AS CAT, TRIM(REGEXP_SUBSTR(m.EPC, '[^;]+', 1, lv.n)) AS TOKEN, "
        'COUNT(DISTINCT m.SPL_ID) AS N '
        'FROM matched m '
        f'JOIN (SELECT LEVEL n FROM DUAL CONNECT BY LEVEL <= {_MAX_SPLIT_PARTS}) lv '
        "ON lv.n <= REGEXP_COUNT(m.EPC, ';') + 1 "
        'WHERE m.EPC IS NOT NULL '
        "GROUP BY TRIM(REGEXP_SUBSTR(m.EPC, '[^;]+', 1, lv.n))"
    )

    union_sql = '\nUNION ALL\n'.join(branches)
    return f"""
        WITH {text_cte_sql}matched AS (
            SELECT /*+ MATERIALIZE */ s.SPL_ID, s.DOCUMENT_TYPE, s.MARKET_CATEGORIES, s.EPC
            FROM {base_table} s
            WHERE {where_sql}
        )
        {union_sql}
    """.strip()


# ---------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------

def rows_to_facets(rows):
    """
    Long-format (cat, token, n) rows -> the payload the sidebar reads.

    Every scalar bucket is emitted even at zero, because the sidebar needs the
    difference between "this category counted nothing" and "this category was
    never computed" -- the latter is what it uses to decide whether hiding
    zero-count options is meaningful at all.
    """
    counts = {}
    grouped = {cat: {} for cat in _GROUPED_CATEGORIES}

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

    for cat in _GROUPED_CATEGORIES:
        ordered = sorted(grouped[cat].items(), key=lambda kv: kv[1], reverse=True)[:_GROUPED_LIMIT]
        facets[cat] = [{'value': k, 'label': k, 'count': v} for k, v in ordered]

    return facets
