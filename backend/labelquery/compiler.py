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
the internal FDA deployment; this builder is deliberately local-only, which is
also the only mode where ``labeling.spl_sections.search_vector`` exists.

Free text runs against that generated TSVECTOR column, so anything text-shaped
(full text, labeling sections, MedDRA terms) shares ``_tsquery_sql`` rather than
falling back to ILIKE over content_xml, which would be a sequential scan.
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

# to_tsquery input is not parameterizable as an operator string, so an advanced
# query is rebuilt from scratch out of a validated token stream. Nothing from the
# user reaches SQL as text; the assembled expression is still bound as a param.
_ADVANCED_WORD_RE = re.compile(r'[\w][\w\-]*\*?')


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

def _advanced_tsquery_expression(text):
    """
    Translates the FDALabel "Advanced Search" dialect into a to_tsquery string.

    Accepted: AND/OR/NOT (and &|!), parentheses, quoted phrases, and a trailing
    ``*`` for prefix matching. Everything else is dropped rather than escaped,
    because a stray character in to_tsquery input is a hard SQL error, not a
    zero-result query.
    """
    tokens = []
    i = 0
    text = str(text)
    while i < len(text):
        ch = text[i]
        if ch in '()':
            tokens.append(ch)
            i += 1
        elif ch == '"':
            end = text.find('"', i + 1)
            if end == -1:
                end = len(text)
            phrase = _ADVANCED_WORD_RE.findall(text[i + 1:end])
            if phrase:
                tokens.append('(' + ' <-> '.join(phrase) + ')')
            i = end + 1
        elif ch in '&|!':
            tokens.append({'&': '&', '|': '|', '!': '!'}[ch])
            i += 1
        elif ch.isspace():
            i += 1
        else:
            m = _ADVANCED_WORD_RE.match(text, i)
            if not m:
                i += 1
                continue
            word = m.group(0)
            upper = word.upper()
            if upper == 'AND':
                tokens.append('&')
            elif upper == 'OR':
                tokens.append('|')
            elif upper == 'NOT':
                tokens.append('!')
            else:
                tokens.append(word.replace('*', ':*'))
            i = m.end()

    # Insert an implicit & between adjacent operands, the way a search box is
    # expected to behave ("hepatic failure" == "hepatic AND failure"). `!` and
    # `(` start an operand too, so "(a|b) NOT c" needs the & just as much as
    # "a b" does — tsquery rejects both `) ! c` and `a b`.
    out = []
    for tok in tokens:
        prev = out[-1] if out else None
        starts_operand = tok not in ('&', '|', ')')
        prev_ends_operand = prev is not None and prev not in ('&', '|', '!', '(')
        if starts_operand and prev_ends_operand:
            out.append('&')
        out.append(tok)

    out = _repair_tsquery_tokens(out)
    if not out:
        raise QueryCompileError('Advanced search text contains no searchable words.')
    return ' '.join(out)


def _repair_tsquery_tokens(tokens):
    """
    Makes a token stream syntactically valid for to_tsquery.

    A half-typed query ("hepatic AND", "(failure") is normal in a search box but
    a hard SQL error in to_tsquery, so unbalanced parens, empty groups and
    dangling operators are repaired rather than reported.
    """
    # Drop unmatched ')' and remember how many '(' stay open.
    balanced = []
    depth = 0
    for tok in tokens:
        if tok == ')':
            if depth == 0:
                continue
            depth -= 1
        elif tok == '(':
            depth += 1
        balanced.append(tok)
    balanced.extend([')'] * depth)

    # Collapse empty groups and strip operators that lost an operand, to a fixed
    # point — each repair can expose another ("(a AND)" -> "(a)" -> "a").
    changed = True
    while changed:
        changed = False
        for i, tok in enumerate(balanced):
            prev = balanced[i - 1] if i > 0 else None
            nxt = balanced[i + 1] if i + 1 < len(balanced) else None

            if tok == '(' and nxt == ')':
                del balanced[i:i + 2]
            elif tok in ('&', '|') and (prev is None or prev in ('(', '&', '|', '!')):
                del balanced[i]
            elif tok in ('&', '|', '!') and (nxt is None or nxt == ')'):
                del balanced[i]
            else:
                continue
            changed = True
            break

    return balanced if any(t not in ('(', ')', '&', '|', '!') for t in balanced) else []


def _tsquery_sql(mode, text, bag):
    """Returns the SQL expression producing a tsquery for `text`."""
    text = (text or '').strip()
    if not text:
        return None
    if mode == 'advanced':
        return f"to_tsquery('english', {bag.add(_advanced_tsquery_expression(text))})"
    # Simple search is FDALabel's exact-phrase mode.
    return f"phraseto_tsquery('english', {bag.add(text)})"


def _tsquery_union(terms, bag):
    """OR-combines phrase queries for a list of terms into one tsquery."""
    parts = [f"phraseto_tsquery('english', {bag.add(t)})" for t in terms if t]
    if not parts:
        return None
    return '(' + ' || '.join(parts) + ')'


def _sections_exists(tsquery_sql, section_filters, bag):
    """EXISTS over spl_sections, optionally narrowed to specific sections."""
    conditions = ['sec.spl_id = s.spl_id']
    if tsquery_sql:
        conditions.append(f'sec.search_vector @@ {tsquery_sql}')
    if section_filters:
        loincs = [f for f in section_filters if re.match(r'^[\d.\-]+$', f)]
        titles = [f'%{f}%' for f in section_filters if f not in loincs]
        alts = []
        if loincs:
            alts.append(f'sec.loinc_code = ANY({bag.add(loincs)})')
        if titles:
            alts.append(f'sec.title ILIKE ANY({bag.add(titles)})')
        if alts:
            conditions.append('(' + ' OR '.join(alts) + ')')
    return (
        'EXISTS (SELECT 1 FROM labeling.spl_sections sec WHERE '
        + ' AND '.join(conditions)
        + ')'
    )


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
    return (
        f"EXISTS (SELECT 1 FROM unnest(string_to_array({column}, ';')) AS item "
        f'WHERE btrim(item) ILIKE ANY ({bag.add(values)}))'
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
    tsquery = _tsquery_sql(criterion.get('mode') or 'simple', criterion.get('text'), bag)
    if not tsquery:
        return None
    return _sections_exists(tsquery, None, bag)


def _c_labeling_section(criterion, bag, warnings):
    sections = _as_list(criterion.get('sections'))
    tsquery = _tsquery_sql(criterion.get('mode') or 'simple', criterion.get('text'), bag)
    if not tsquery and not sections:
        return None
    # Blank text with a section chosen is FDALabel's "check for presence of a
    # labeling section" behaviour.
    return _sections_exists(tsquery, sections, bag)


def _c_market_status(criterion, bag, warnings):
    values = {v.lower() for v in _as_list(criterion.get('values'))}
    if not values:
        return None
    alts = []
    if 'rld' in values:
        alts.append('s.is_rld = 1')
    if 'rs' in values:
        alts.append('s.is_rs = 1')
    if 'marketed' in values or 'discontinued' in values:
        # Marketing status is Orange Book's, not the SPL's; match on the
        # application number the label carries.
        wanted = []
        if 'marketed' in values:
            wanted.extend(['RX', 'OTC'])
        if 'discontinued' in values:
            wanted.append('DISCN')
        alts.append(
            'EXISTS (SELECT 1 FROM public.orange_book ob WHERE '
            f's.appr_num ILIKE \'%%\' || ob.appl_no || \'%%\' AND ob.type = ANY({bag.add(wanted)}))'
        )
    if not alts:
        return None
    return '(' + ' OR '.join(alts) + ')'


def _c_meddra(criterion, bag, warnings, expand_meddra=None):
    terms = _as_list(criterion.get('terms')) or _split_terms(criterion.get('text'))
    if not terms:
        return None
    level = (criterion.get('level') or 'pt').lower()
    if expand_meddra and level != 'pt':
        expanded = expand_meddra(level, terms)
        if expanded:
            terms = expanded
        else:
            warnings.append(
                f'No MedDRA {level.upper()} terms matched; searched the text as entered.'
            )
    tsquery = _tsquery_union(terms, bag)
    if not tsquery:
        return None
    return _sections_exists(tsquery, _as_list(criterion.get('sections')), bag)


def _c_pharm_class(criterion, bag, warnings):
    terms = _as_list(criterion.get('terms')) or _split_terms(criterion.get('text'))
    if not terms:
        return None
    class_type = (criterion.get('classType') or 'any').lower()
    patterns = [f'%{t}%' for t in terms]

    alts = []
    if class_type in ('any', 'epc'):
        alts.append(
            'EXISTS (SELECT 1 FROM labeling.epc_map em WHERE em.spl_id = s.spl_id '
            f'AND em.epc_term ILIKE ANY({bag.add(patterns)}))'
        )
        alts.append(_like_any(['s.epc'], patterns, bag))
    if class_type != 'epc':
        # MoA / PE / CS live in substance_indexing, reachable through the
        # label's active ingredients.
        type_clause = ''
        if class_type in CLASS_TYPE_FILTERS:
            types, suffixes = CLASS_TYPE_FILTERS[class_type]
            type_clause = (
                f' AND (si.indexing_type ILIKE ANY({bag.add(types)})'
                f' OR si.indexing_name ILIKE ANY({bag.add(suffixes)}))'
            )
        alts.append(
            'EXISTS (SELECT 1 FROM labeling.active_ingredients_map aim '
            'JOIN labeling.substance_indexing si '
            'ON UPPER(si.substance_name) = UPPER(aim.substance_name) '
            'WHERE aim.spl_id = s.spl_id '
            f'AND si.indexing_name ILIKE ANY({bag.add(patterns)}){type_clause})'
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
    tokens = _merge_application_prefixes(
        [t for t in re.split(r'[\s,;:]+', str(criterion.get('text') or '')) if t]
    )
    if not tokens:
        return None
    ingredient_type = (criterion.get('ingredientType') or 'active').lower()

    alts = []
    unrecognized = []
    for token in tokens:
        if _UUID_RE.match(token):
            alts.append(f'(s.set_id = {bag.add(token)} OR s.spl_id = {bag.add(token)})')
        elif _NDC_RE.match(token):
            # NDCs are stored with hyphens but users paste either form, and a
            # package-level NDC should still match its product-level label.
            parts = token.split('-')
            base = parts[0] + parts[1]
            alts.append(f"REPLACE(s.ndc_codes, '-', '') ILIKE {bag.add(f'%{base}%')}")
        elif _MONOGRAPH_RE.match(token):
            alts.append(_like_any(['s.appr_num', 's.market_categories'], [f'%{token}%'], bag))
        elif _DEA_RE.match(token):
            # No DEA schedule column exists; the schedule is stated in the
            # label text, so this falls through to a phrase search.
            alts.append(
                _sections_exists(
                    f"phraseto_tsquery('english', {bag.add('Schedule ' + token[1:].upper())})",
                    None,
                    bag,
                )
            )
        elif _PREFIXED_APPL_RE.match(token):
            kind, number = _PREFIXED_APPL_RE.match(token).groups()
            alts.append(
                _like_any(
                    ['s.appr_num'],
                    [f'%{kind.upper()} {number.zfill(6)}%', f'%{kind.upper()} {number}%'],
                    bag,
                )
            )
        elif _APPL_RE.match(token):
            padded = token.zfill(6)
            alts.append(_like_any(['s.appr_num'], [f'%{padded}%', f'%{token}%'], bag))
        elif _UNII_RE.match(token):
            if not unii_available:
                # The column exists and is indexed but the SPL importer leaves it
                # blank, so this would return nothing at all rather than nothing
                # matching. Say so instead of looking like a real zero-result.
                warnings.append(
                    f'UNII {token} was skipped: ingredient UNII codes are not populated '
                    'in this database. Search the ingredient by name in Product Name(s).'
                )
                continue
            conditions = [f'aim.spl_id = s.spl_id', f'UPPER(aim.unii) = {bag.add(token.upper())}']
            if ingredient_type == 'active':
                conditions.append('aim.is_active = 1')
            elif ingredient_type == 'inactive':
                conditions.append('aim.is_active = 0')
            alts.append(
                'EXISTS (SELECT 1 FROM labeling.active_ingredients_map aim WHERE '
                + ' AND '.join(conditions)
                + ')'
            )
        else:
            unrecognized.append(token)

    if unrecognized:
        warnings.append(
            'Not recognized as an identifier: ' + ', '.join(unrecognized)
            + '. Use Product Name(s) for names.'
        )
    alts = [a for a in alts if a]
    if not alts:
        # The user did type identifiers; none of them could be searched. Dropping
        # the criterion would widen the query to everything else on the panel —
        # or to every label, if this was the only criterion. Match nothing
        # instead, and let the warnings above explain why.
        return 'FALSE'
    return '(' + ' OR '.join(alts) + ')'


def _c_chemical_structure(criterion, bag, warnings):
    if not (criterion.get('structure') or '').strip():
        return None
    warnings.append(
        'Chemical Structure search needs a structure index that this deployment '
        'does not have; the criterion was ignored.'
    )
    return None


def _compile_criterion(criterion, bag, warnings, expand_meddra, capabilities):
    ctype = criterion.get('type')
    value = criterion.get('value') or {}

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
    if ctype == 'chemicalStructure':
        return _c_chemical_structure(value, bag, warnings)

    raise QueryCompileError(f'Unknown criterion type: {ctype!r}')


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

SELECT_COLUMNS = """
    s.set_id, s.spl_id, s.product_names, s.generic_names, s.manufacturer,
    s.appr_num, s.ndc_codes, s.revised_date, s.market_categories, s.doc_type,
    s.active_ingredients, s.dosage_forms, s.routes, s.epc, s.is_rld, s.is_rs,
    s.initial_approval_year
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
}


def order_by_sql(sort, direction):
    """ORDER BY for a whitelisted sort token, always tie-broken on set_id."""
    column = SORT_COLUMNS.get(sort or '', 's.revised_date')
    descending = str(direction or 'desc').lower() != 'asc'
    return f"{column} {'DESC' if descending else 'ASC'} NULLS LAST, s.set_id"


def compile_where(query, expand_meddra=None, capabilities=None):
    """
    Turns a criteria tree into ``(where_sql, params, warnings)``.

    `expand_meddra(level, terms) -> [pt_names]` and `capabilities` are injected
    rather than imported so the compiler stays free of DB access and stays
    unit-testable. `capabilities` reports what this deployment's data actually
    supports (currently just `unii`), so a criterion backed by an unpopulated
    column can warn instead of returning a misleading empty result.
    """
    bag = _ParamBag()
    warnings = []
    group_clauses = []
    capabilities = capabilities or {}

    for group in (query.get('groups') or []):
        criterion_clauses = []
        for criterion in (group.get('criteria') or []):
            clause = _compile_criterion(criterion, bag, warnings, expand_meddra, capabilities)
            if clause:
                criterion_clauses.append(clause)
        if criterion_clauses:
            group_clauses.append('(' + ' AND '.join(criterion_clauses) + ')')

    # Only the current version of each SPL set, matching every other label query
    # in the app.
    where = ['s.is_latest = TRUE']
    if group_clauses:
        where.append('(' + ' OR '.join(group_clauses) + ')')
    else:
        warnings.append('No criteria were filled in; showing the most recent labels.')

    return ' AND '.join(where), bag.params, warnings
