"""
Compiles an FDALabel-style criteria tree into a single Postgres statement.

The shape mirrors the FDALabel search UI one-to-one:

    {"groups": [{"criteria": [{"type": ..., "value": {...}}, ...]}, ...]}

Criteria inside a group are ANDed (the "&" the UI draws between cards); groups
are ORed (the UI's "Add New Group of Criteria"). Every criterion compiles to a
predicate over ``labeling.sum_spl s`` — never a JOIN — so adding a criterion can
never multiply rows, and the group/criterion nesting maps straight onto nested
parentheses.

Only Postgres is supported here. The Oracle paths in FDALabelDBService exist for
the internal FDA deployment; this builder is deliberately local-only.

Nothing here searches label *text*. ``labeling.spl_sections`` and the TSVECTOR
columns that backed full-text search were dropped -- see
``database/scripts/db_12_drop_fulltext_search.py`` -- so the Full Text, MedDRA
and section-text criteria are rejected with a warning rather than compiled. The
Labeling Section criterion survives only for its two ``sum_spl``-backed
pseudo-sections, Product Title and Initial U.S. Approval. Every criterion that
remains is a predicate over ``sum_spl`` alone, which is why compilation returns
a single WHERE clause and no separate section half.
"""

import re

# Columns whose values are "; "-joined lists (see db_07_import_labels.py), so a
# membership test has to be a wildcard ILIKE rather than an equality check.
_LIST_COLUMNS = {
    'labelingType': 's.doc_type',
    'applicationType': 's.market_categories',
    'route': 's.routes',
    'dosageForm': 's.dosage_forms',
}

# Pharmacologic class filters, as (indexing_type values, indexing_name suffixes).
#
# Neither signal alone is enough. substance_indexing.indexing_type holds 'EPC',
# 'MoA', 'PE', 'Chemical' and 'Unknown' — never the UI's tokens, so ILIKE
# '%cs%' matched nothing. And the importer files every Chemical Structure class
# under 'Unknown' while leaving the '[CS]' marker in the name, so type alone
# loses 2818 of them. FDA always appends the bracketed class to the name, and
# that suffix is 100% consistent here, so it is matched too.
#
# '[' is not a LIKE metacharacter in Postgres, so these patterns are literal.
CLASS_TYPE_FILTERS = {
    'epc': (['EPC'], ['%[EPC]']),
    'moa': (['MoA'], ['%[MoA]']),
    'pe': (['PE'], ['%[PE]']),
    'cs': (['Chemical'], ['%[CS]', '%[Chemical/Ingredient]']),
}

_PRODUCT_NAME_COLUMNS = {
    'trade': ['s.product_names'],
    'generic': ['s.generic_names'],
    'unii': ['s.active_ingredients'],
    'any': ['s.product_names', 's.generic_names', 's.active_ingredients'],
}

_UUID_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.I)
_NDC_RE = re.compile(r'^\d{4,5}-\d{3,4}(-\d{1,2})?$')
_APPL_RE = re.compile(r'^\d{3,6}$')
_DEA_RE = re.compile(r'^C(I{1,3}|IV|V)$', re.I)
_MONOGRAPH_RE = re.compile(r'^M\d{2,4}$', re.I)
_UNII_RE = re.compile(r'^[0-9A-Z]{10}$')
# appr_num is stored as "NDA 021436" (see db_07_import_labels.extract_approvals),
# so a typed prefix is signal, not noise.
_APPL_PREFIXES = ('ANADA', 'ANDA', 'NADA', 'BLA', 'NDA')
_PREFIXED_APPL_RE = re.compile(r'^(' + '|'.join(_APPL_PREFIXES) + r')[\s-]*(\d{3,6})$', re.I)

COMMON_FULLTEXT_WORDS = {
    # Standard English stopwords
    'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and',
    'any', 'are', 'aren', 'as', 'at', 'be', 'because', 'been', 'before', 'being',
    'below', 'between', 'both', 'but', 'by', 'can', 'cannot', 'could', 'did',
    'do', 'does', 'doing', 'down', 'during', 'each', 'few', 'for', 'from',
    'further', 'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers',
    'herself', 'him', 'himself', 'his', 'how', 'i', 'if', 'in', 'into', 'is',
    'it', 'its', 'itself', 'just', 'me', 'more', 'most', 'my', 'myself', 'no',
    'nor', 'not', 'now', 'of', 'off', 'on', 'once', 'only', 'or', 'other',
    'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same', 'she', 'should',
    'so', 'some', 'such', 'than', 'that', 'the', 'their', 'theirs', 'them',
    'themselves', 'then', 'there', 'these', 'they', 'this', 'those', 'through',
    'to', 'too', 'under', 'until', 'up', 'very', 'was', 'we', 'were', 'what',
    'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'with', 'would',
    'you', 'your', 'yours', 'yourself', 'yourselves',

    # Ubiquitous drug labeling terms
    'drug', 'drugs', 'product', 'products', 'patient', 'patients', 'dose', 'doses',
    'dosage', 'dosages', 'mg', 'ml', 'g', 'mcg', 'kg', 'tablet', 'tablets',
    'capsule', 'capsules', 'treatment', 'treatments', 'treat', 'treated', 'treating',
    'administer', 'administered', 'administration', 'administering',
    'clinical', 'effect', 'effects', 'safety', 'efficacy', 'study', 'studies',
    'label', 'labels', 'labeling', 'information', 'daily', 'day', 'days',
    'use', 'used', 'uses', 'using', 'contraindication', 'contraindications',
    'warning', 'warnings', 'precaution', 'precautions', 'indication', 'indications',
    'adverse', 'reaction', 'reactions', 'table', 'section', 'package', 'insert',
    'oral', 'injectable', 'solution', 'usp', 'fda', 'ndc', 'rx'
}


def is_common_fulltext_query(text):
    if not text or not str(text).strip():
        return False, []
    clean = re.sub(r'[{}\[\]\(\)"\',;:\-]', ' ', str(text).lower())
    tokens = [t.strip() for t in clean.split() if t.strip()]
    tokens = [t for t in tokens if t not in ('and', 'or', 'not')]
    if not tokens:
        return False, []
    common = [t for t in tokens if t in COMMON_FULLTEXT_WORDS or len(t) <= 1]
    if len(common) == len(tokens):
        return True, common
    return False, []


class QueryCompileError(ValueError):
    """Raised for a criterion the compiler cannot turn into valid SQL."""


class _ParamBag:
    """Hands out collision-free placeholder names for one compilation."""

    def __init__(self):
        self.params = {}
        self._n = 0

    def add(self, value):
        self._n += 1
        key = f'p{self._n}'
        self.params[key] = value
        return f'%({key})s'


def _split_terms(text):
    """Splits a user text box into terms on comma/semicolon/newline."""
    if not text:
        return []
    return [t.strip() for t in re.split(r'[;,\n]', str(text)) if t.strip()]


def _as_list(value):
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return [str(v).strip() for v in value if str(v).strip()]
    return [str(value).strip()] if str(value).strip() else []


def _like_any(columns, patterns, bag, negate=False):
    """`col ILIKE ANY(ARRAY[...])` across one or more columns."""
    if not patterns:
        return None
    placeholder = bag.add(patterns)
    if negate:
        # COALESCE matters here: a NULL column is "does not contain" from the
        # user's point of view, but NULL NOT ILIKE ALL (...) is NULL, which
        # would drop the row instead of keeping it.
        parts = [f"(COALESCE({col}, '') NOT ILIKE ALL ({placeholder}))" for col in columns]
        return '(' + ' AND '.join(parts) + ')'
    parts = [f'({col} ILIKE ANY ({placeholder}))' for col in columns]
    return '(' + ' OR '.join(parts) + ')'


# ---------------------------------------------------------------------------
# Full-text
# ---------------------------------------------------------------------------

TITLE_TO_LOINCS = {
    'WARNINGS AND PRECAUTIONS': ['43685-7', '34071-1', '42232-9'],
    'BOXED WARNING': ['34066-1'],
    'INDICATIONS AND USAGE': ['34067-9'],
    'DOSAGE AND ADMINISTRATION': ['34068-7'],
    'DOSAGE FORMS AND STRENGTHS': ['43678-2'],
    'CONTRAINDICATIONS': ['34070-3'],
    'ADVERSE REACTIONS': ['34084-4'],
    'DRUG INTERACTIONS': ['34073-7'],
    'USE IN SPECIFIC POPULATIONS': ['43684-0'],
    'PREGNANCY': ['42228-7'],
    'LACTATION': ['77290-5'],
    'LABOR AND DELIVERY': ['34079-4'],
    'NURSING MOTHERS': ['34080-2'],
    'PEDIATRIC USE': ['34081-0'],
    'GERIATRIC USE': ['34082-8'],
    'DRUG ABUSE AND DEPENDENCE': ['42227-9'],
    'OVERDOSAGE': ['34088-5'],
    'DESCRIPTION': ['34089-3'],
    'CLINICAL PHARMACOLOGY': ['34090-1'],
    'MECHANISM OF ACTION': ['43679-0'],
    'PHARMACODYNAMICS': ['43681-6'],
    'PHARMACOKINETICS': ['43682-4'],
    'NONCLINICAL TOXICOLOGY': ['34091-9'],
    'CARCINOGENESIS': ['34083-6'],
    'CLINICAL STUDIES': ['34092-7'],
    'REFERENCES': ['34093-5'],
    'HOW SUPPLIED': ['34069-5'],
    'PATIENT COUNSELING INFORMATION': ['34076-0'],
    'WARNINGS': ['34071-1', '43685-7'],
    'PRECAUTIONS': ['42232-9', '43685-7']
}


# ---------------------------------------------------------------------------
# Per-criterion compilers
#
# Each returns a SQL predicate string, or None to mean "this criterion is empty,
# skip it". Raising QueryCompileError rejects the whole request.
# ---------------------------------------------------------------------------

def _c_value_list(criterion, key, bag, warnings):
    """
    Labeling Types / Application Types / Routes — all `; `-joined columns.

    The match is against individual list *elements*, not the joined string. A
    plain ILIKE '%NDA%' over "ANDA; NDA authorized generic" is true for all
    three marketing categories, so selecting NDA would silently return every
    ANDA label. Splitting first makes "NDA" mean the category NDA.

    A value containing % is still treated as a pattern, but scoped to one
    element — that is how the quick picks match doc_type variants
    ("%HUMAN PRESCRIPTION%") without also matching neighbouring entries.
    """
    column = _LIST_COLUMNS[key]
    values = _as_list(criterion.get('values'))
    if not values:
        return None

    # The GIN trigram index on the raw column narrows candidate rows first.
    broad = [v if '%' in v else f'%{v}%' for v in values]
    has_wildcard = any('%' in v for v in values)
    if has_wildcard:
        elem_check = f"btrim(item) ILIKE ANY ({bag.add(values)})"
    else:
        elem_check = f"btrim(item) = ANY ({bag.add(values)})"

    return (
        f'({column} ILIKE ANY ({bag.add(broad)}) AND '
        f"EXISTS (SELECT 1 FROM unnest(string_to_array({column}, ';')) AS item "
        f'WHERE {elem_check}))'
    )


def _c_product_name(criterion, bag, warnings):
    field = criterion.get('field') or 'any'
    op = criterion.get('op') or 'contains'
    terms = _split_terms(criterion.get('text'))
    if not terms:
        return None
    columns = _PRODUCT_NAME_COLUMNS.get(field) or _PRODUCT_NAME_COLUMNS['any']

    if op == 'equals':
        patterns = terms[:]
    elif op == 'startsWith':
        patterns = [f'{t}%' for t in terms]
    else:
        patterns = [f'%{t}%' for t in terms]

    return _like_any(columns, patterns, bag, negate=(op == 'notContains'))


def _c_full_text(criterion, bag, warnings):
    if (criterion.get('text') or '').strip():
        warnings.append('Full-text search is disabled for the local database.')
    return None


def _c_labeling_section(criterion, bag, warnings):
    raw_sections = _as_list(criterion.get('sections'))
    text = (criterion.get('text') or '').strip()

    if not text and not raw_sections:
        return None

    is_product_title = any(s in ('SPLTITLE', 'Product Title') for s in raw_sections)
    is_approval_year = any(s in ('43683-2', 'Initial U.S. Approval [4 Digit Year]') for s in raw_sections)
    other_sections = [s for s in raw_sections if s not in ('SPLTITLE', 'Product Title', '43683-2', 'Initial U.S. Approval [4 Digit Year]')]

    if text or other_sections:
        warnings.append('Section text and LOINC section search are disabled for the local database.')

    preds = []

    # 1. Virtual Section: Product Title
    if is_product_title:
        if text:
            p_val = bag.add(f'%{text}%')
            preds.append(f"(s.product_names ILIKE {p_val} OR s.generic_names ILIKE {p_val})")
        else:
            preds.append("(s.product_names IS NOT NULL AND s.product_names <> '')")

    # 2. Virtual Section: Initial U.S. Approval
    if is_approval_year:
        if text and text.isdigit():
            p_val = bag.add(int(text))
            preds.append(f"(s.initial_approval_year = {p_val})")
        elif text:
            p_val = bag.add(f'%{text}%')
            preds.append(f"(CAST(s.initial_approval_year AS TEXT) ILIKE {p_val})")
        else:
            preds.append("(s.initial_approval_year IS NOT NULL)")

    if not preds:
        return None
    if len(preds) == 1:
        return preds[0]
    return '(' + ' OR '.join(preds) + ')'


def _c_market_status(criterion, bag, warnings):
    status = (criterion.get('status') or '').strip().lower()
    min_date = (criterion.get('startDateMin') or '').replace('-', '').strip()
    max_date = (criterion.get('startDateMax') or '').replace('-', '').strip()
    values = {v.lower() for v in _as_list(criterion.get('values'))}

    if not status and not min_date and not max_date and not values:
        return None

    alts = []
    if 'rld' in values:
        alts.append('s.is_rld = 1')

    if status == 'active' or 'marketed' in values:
        alts.append(
            "EXISTS (SELECT 1 FROM public.orange_book ob WHERE s.appr_num ILIKE '%%' || ob.appl_no || '%%' AND ob.type = ANY('{RX,OTC}'))"
        )
    elif status in ('completed', 'discontinued') or 'discontinued' in values:
        alts.append(
            "EXISTS (SELECT 1 FROM public.orange_book ob WHERE s.appr_num ILIKE '%%' || ob.appl_no || '%%' AND ob.type = 'DISCN')"
        )

    if min_date or max_date:
        warnings.append(
            'Start Date range filtering for Market Status is available on Oracle targets and was ignored for local queries.'
        )

    if not alts:
        return None
    return '(' + ' OR '.join(alts) + ')'


def _c_meddra(criterion, bag, warnings, expand_meddra=None):
    terms = _as_list(criterion.get('terms')) or _split_terms(criterion.get('text'))
    if terms:
        warnings.append('MedDRA search is disabled for the local database.')
    return None


def _c_pharm_class(criterion, bag, warnings):
    terms = _as_list(criterion.get('terms')) or _split_terms(criterion.get('text'))
    if not terms:
        return None
    class_type = (criterion.get('classType') or 'any').lower()
    
    # Exact discrete match on auto-completed standard terms (with wildcard fallback if % is passed)
    alts = []
    if class_type in ('any', 'epc'):
        # Discrete mapping table exact match
        p_terms = bag.add(terms)
        alts.append(
            f's.spl_id IN (SELECT em.spl_id FROM labeling.epc_map em WHERE em.epc_term = ANY({p_terms}))'
        )
    if class_type != 'epc':
        type_clause = ''
        if class_type in CLASS_TYPE_FILTERS:
            types, suffixes = CLASS_TYPE_FILTERS[class_type]
            type_clause = (
                f' AND (si.indexing_type = ANY({bag.add(types)})'
                f' OR si.indexing_name ILIKE ANY({bag.add(suffixes)}))'
            )
        p_terms = bag.add(terms)
        alts.append(
            's.spl_id IN ('
            'SELECT aim.spl_id FROM labeling.active_ingredients_map aim '
            'JOIN labeling.substance_indexing si '
            'ON UPPER(si.substance_name) = UPPER(aim.substance_name) '
            f'WHERE si.indexing_name = ANY({p_terms}){type_clause})'
        )
    alts = [a for a in alts if a]
    return '(' + ' OR '.join(alts) + ')'


def _merge_application_prefixes(tokens):
    """Rejoins "NDA 021436", which the separator split into two tokens."""
    merged = []
    i = 0
    while i < len(tokens):
        token = tokens[i]
        nxt = tokens[i + 1] if i + 1 < len(tokens) else None
        if token.upper() in _APPL_PREFIXES and nxt and _APPL_RE.match(nxt):
            merged.append(f'{token.upper()} {nxt}')
            i += 2
        else:
            merged.append(token)
            i += 1
    return merged


def _c_identifier(criterion, bag, warnings, unii_available=True):
    alts = []
    set_spl_guid = str(criterion.get('setSplGuid') or '').strip()
    raw_guids = criterion.get('setSplGuids')
    set_spl_guids = raw_guids if isinstance(raw_guids, list) else []
    appl_kind = str(criterion.get('applKind') or '').strip().upper()
    appl_num = str(criterion.get('applNum') or '').strip()
    unii_code = str(criterion.get('uniiCode') or '').strip().upper()

    all_guids = []
    if set_spl_guid:
        all_guids.append(set_spl_guid)
    for g in set_spl_guids:
        g_clean = str(g).strip()
        if g_clean and g_clean not in all_guids:
            all_guids.append(g_clean)

    if all_guids:
        if len(all_guids) == 1:
            p = bag.add(all_guids[0])
            alts.append(f'(s.set_id = {p} OR s.spl_id = {p})')
        else:
            p_arr = bag.add(all_guids)
            alts.append(f'(s.set_id = ANY({p_arr}) OR s.spl_id = ANY({p_arr}))')

    if appl_num:
        digits = re.sub(r'\D', '', appl_num)
        if digits:
            padded = digits.zfill(6)
            if appl_kind:
                alts.append(_like_any(['s.appr_num'], [f'%{appl_kind} {padded}%', f'%{appl_kind} {digits}%'], bag))
            else:
                alts.append(_like_any(['s.appr_num'], [f'%{padded}%', f'%{digits}%'], bag))

    if unii_code:
        alts.append(
            f"s.spl_id IN (SELECT aim.spl_id FROM labeling.active_ingredients_map aim WHERE UPPER(aim.unii) = {bag.add(unii_code)})"
        )

    alts = [a for a in alts if a]
    if not alts:
        return None
    return '(' + ' AND '.join(alts) + ')'


def _c_oracle_only(value, warnings, label, key):
    """
    A criterion the FDALabel Oracle database can answer but the local import
    cannot: labeling.sum_spl carries no DEA schedule and no active-moiety
    breakdown, and db_07_import_labels does not derive either from the SPL XML.

    Ignoring it silently would widen the result set without saying so, so this
    warns instead. Compiling it away is still the right call -- raising would
    reject a query that runs fine against Oracle, and target_db is the user's
    switch, not the criterion's.
    """
    if not _as_list(value.get(key)):
        return None
    warnings.append(
        f'{label} is only available against the FDALabel Oracle database; '
        'the criterion was ignored for this local search.'
    )
    return None


def _c_application_type(value, bag, warnings):
    values = _as_list(value.get('values'))
    is_rld = bool(value.get('isRld') or value.get('is_rld'))

    preds = []
    if is_rld:
        preds.append('s.is_rld = 1')

    if values:
        warnings.append(
            'Application Types / Marketing Categories category dropdown search is currently unavailable for the local database and was ignored. Use an Oracle target for category filters.'
        )

    if not preds:
        return None
    return '(' + ' AND '.join(preds) + ')'


def _compile_criterion(criterion, bag, warnings, expand_meddra, capabilities):
    ctype = criterion.get('type')
    value = criterion.get('value') or {}

    if ctype == 'labelingType':
        plr = str(value.get('plr') or value.get('formatGroup') or 'all').lower()
        if plr in ('plr', 'non_plr', 'non-plr', '1', '2'):
            warnings.append('PLR / non-PLR format filtering is optimized for Oracle CDER-CBER database.')
        return _c_value_list(value, 'labelingType', bag, warnings)
    if ctype == 'applicationType':
        return _c_application_type(value, bag, warnings)
    if ctype in _LIST_COLUMNS:
        return _c_value_list(value, ctype, bag, warnings)
    if ctype == 'productName':
        return _c_product_name(value, bag, warnings)
    if ctype == 'fullText':
        return _c_full_text(value, bag, warnings)
    if ctype == 'labelingSection':
        return _c_labeling_section(value, bag, warnings)
    if ctype == 'marketStatus':
        return _c_market_status(value, bag, warnings)
    if ctype == 'meddra':
        return _c_meddra(value, bag, warnings, expand_meddra)
    if ctype == 'pharmClass':
        return _c_pharm_class(value, bag, warnings)
    if ctype == 'identifier':
        return _c_identifier(value, bag, warnings, capabilities.get('unii', True))
    if ctype == 'deaSchedule':
        return _c_oracle_only(value, warnings, 'DEA schedule search', 'values')
    if ctype == 'activeMoiety':
        return _c_oracle_only(value, warnings, 'Active moiety search', 'terms')

    raise QueryCompileError(f'Unknown criterion type: {ctype!r}')


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

SELECT_COLUMNS = """
    s.set_id, s.spl_id, s.product_names, s.generic_names, s.manufacturer,
    s.appr_num, s.ndc_codes, s.revised_date, s.market_categories, s.doc_type,
    s.active_ingredients, s.dosage_forms, s.routes, s.epc, s.is_rld, s.is_rs,
    s.initial_approval_year,
    (
        SELECT string_agg(DISTINCT aim.unii, '; ' ORDER BY aim.unii)
        FROM labeling.active_ingredients_map aim
        WHERE aim.spl_id = s.spl_id
          AND aim.is_active = 1
          AND aim.unii IS NOT NULL AND aim.unii <> ''
    ) AS active_uniis
"""

# Sortable result columns, keyed by the token the client sends. Whitelisted
# because the value is interpolated into ORDER BY, not bound as a parameter.
SORT_COLUMNS = {
    'product': 's.product_names',
    'generic': 's.generic_names',
    'manufacturer': 's.manufacturer',
    'appr_num': 's.appr_num',
    'market_category': 's.market_categories',
    'doc_type': 's.doc_type',
    'dosage_form': 's.dosage_forms',
    'route': 's.routes',
    'revised_date': 's.revised_date',
    'approval_year': 's.initial_approval_year',
    'set_id': 's.set_id',
    'spl_id': 's.spl_id',
    'epc': 's.epc',
    'unii': 'active_uniis',
}


def sort_column_sql(sort):
    """The single whitelisted `sum_spl` column a result page is ordered by."""
    return SORT_COLUMNS.get(sort or '', 's.revised_date')


def sort_direction_sql(direction):
    return 'DESC' if str(direction or 'desc').lower() != 'asc' else 'ASC'


def order_by_sql(sort, direction):
    """ORDER BY for a whitelisted sort token, always tie-broken on set_id."""
    return (
        f'{sort_column_sql(sort)} {sort_direction_sql(direction)} NULLS LAST, s.set_id'
    )


def _compile_groups(query, bag, warnings, expand_meddra, capabilities):
    """Compiles each group to a single AND-ed predicate, or None when empty."""
    compiled = []

    for group in (query.get('groups') or []):
        r_clauses = []

        for criterion in (group.get('criteria') or []):
            rel_clause = _compile_criterion(criterion, bag, warnings, expand_meddra, capabilities)
            if rel_clause:
                r_clauses.append(rel_clause)

        compiled.append('(' + ' AND '.join(r_clauses) + ')' if r_clauses else None)

    return compiled


def compile_where(query, expand_meddra=None, capabilities=None):
    """
    Turns a criteria tree into ``(where_sql, params, warnings)``.

    Every supported criterion is a predicate over ``labeling.sum_spl s``, so one
    WHERE clause says everything: groups OR together, criteria within a group
    AND together, and there is no second half to recombine.
    """
    capabilities = capabilities or {}

    bag = _ParamBag()
    warnings = []
    compiled = _compile_groups(query, bag, warnings, expand_meddra, capabilities)

    groups = [g for g in compiled if g]

    where = ['s.is_latest = TRUE']
    if groups:
        where.append('(' + ' OR '.join(groups) + ')')
    else:
        warnings.append('No criteria were filled in; showing the most recent labels.')

    return ' AND '.join(where), bag.params, warnings
