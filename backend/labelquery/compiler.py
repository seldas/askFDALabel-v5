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

Free text runs against a generated TSVECTOR column, so anything text-shaped
(full text, labeling sections, MedDRA terms) shares ``_tsquery_sql`` rather than
falling back to ILIKE over content_xml, which would be a sequential scan.

Which column depends on the criterion. A section-scoped search has to stay on
``spl_sections.search_vector`` -- the scope *is* the row. An unscoped full-text
search instead probes ``sum_spl.full_search_vector``, one document-level vector
per label, which turns a scan-and-dedup over every section of every candidate
into a single indexed lookup. That column is only trustworthy once it is fully
populated, so the caller passes ``capabilities['full_fts']`` to say whether this
deployment has it; see ``labelquery.blueprint._capabilities``.

Section predicates come back separately from relational ones so the caller can
run them as a CTE, but that split can only represent ``(R1 OR R2) AND
(S1 OR S2)``. When the criteria tree means something else, compilation falls
back to inline correlated EXISTS -- see :func:`_split_is_faithful`.
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

    Accepted: AND/OR/NOT (and &|!), parentheses, quoted phrases "", exact span braces {},
    and wildcard * for prefix matching.
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
        elif ch == '{':
            end = text.find('}', i + 1)
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
                tokens.append(word.replace('*', ':*').replace('%', ':*'))
            i = m.end()

    # Insert an implicit & between adjacent operands
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
    """
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
            elif tok in ('&', '|') and (nxt is None or nxt == ')'):
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

    # Simple Search logic: full span phrase match, supporting uppercase AND, OR, NOT
    tokens = re.split(r'\b(AND|OR|NOT)\b', text)
    if len(tokens) > 1 and any(t in ('AND', 'OR', 'NOT') for t in tokens):
        parts = []
        op = None
        for tok in tokens:
            t_strip = tok.strip()
            if not t_strip:
                continue
            if t_strip in ('AND', 'OR', 'NOT'):
                op = t_strip
            else:
                ts = f"phraseto_tsquery('english', {bag.add(t_strip)})"
                if not parts:
                    parts.append(ts)
                else:
                    if op == 'OR':
                        parts.append(f"({parts.pop()} || {ts})")
                    elif op == 'NOT':
                        parts.append(f"({parts.pop()} && !{ts})")
                    else:  # AND
                        parts.append(f"({parts.pop()} && {ts})")
                    op = None
        if parts:
            return parts[0]

    # Full span phrase match
    return f"phraseto_tsquery('english', {bag.add(text)})"


def _tsquery_union(terms, bag):
    """
    OR-combines a list of terms into one tsquery.

    Single-word terms are folded into a single ``a | b | c`` to_tsquery rather
    than one phraseto_tsquery each. Phrase queries are lossy for GIN — every
    candidate row has to be refetched from the heap and rechecked — so a MedDRA
    selection that expands to a couple of hundred terms would otherwise pay that
    penalty a couple of hundred times over. Only the genuinely multi-word terms
    still need phrase semantics.
    """
    singles = []
    phrases = []
    for term in terms:
        if not term:
            continue
        words = _ADVANCED_WORD_RE.findall(str(term))
        if len(words) == 1:
            # '*' would turn this into the prefix query the caller did not ask
            # for, and a trailing '-' is the one leftover the word regex can
            # produce that to_tsquery has no operand for.
            word = words[0].replace('*', '').strip('-')
            if word:
                singles.append(word)
        elif words:
            phrases.append(term)

    parts = []
    if singles:
        parts.append(f"to_tsquery('english', {bag.add(' | '.join(singles))})")
    parts += [f"phraseto_tsquery('english', {bag.add(t)})" for t in phrases]
    if not parts:
        return None
    return '(' + ' || '.join(parts) + ')'


LOINC_TO_TITLES = {
    '43685-7': ['%WARNINGS AND PRECAUTIONS%', '%WARNINGS%'],
    '34071-1': ['%WARNINGS%'],
    '42232-9': ['%PRECAUTIONS%'],
    '34066-1': ['%BOXED WARNING%', '%BOX WARNING%'],
    '34067-9': ['%INDICATIONS AND USAGE%', '%INDICATIONS%'],
    '34068-7': ['%DOSAGE AND ADMINISTRATION%', '%DOSAGE%'],
    '43678-2': ['%DOSAGE FORMS AND STRENGTHS%', '%DOSAGE FORMS%'],
    '34070-3': ['%CONTRAINDICATIONS%'],
    '34084-4': ['%ADVERSE REACTIONS%'],
    '34073-7': ['%DRUG INTERACTIONS%'],
    '43684-0': ['%USE IN SPECIFIC POPULATIONS%'],
    '42228-7': ['%Pregnancy%'],
    '77290-5': ['%Lactation%'],
    '34079-4': ['%Labor and Delivery%'],
    '77291-3': ['%Reproductive Potential%'],
    '34080-2': ['%Nursing Mothers%'],
    '34081-0': ['%Pediatric Use%'],
    '34082-8': ['%Geriatric Use%'],
    '42227-9': ['%DRUG ABUSE AND DEPENDENCE%', '%DRUG ABUSE%'],
    '34088-5': ['%OVERDOSAGE%'],
    '34089-3': ['%DESCRIPTION%'],
    '34090-1': ['%CLINICAL PHARMACOLOGY%'],
    '43679-0': ['%Mechanism of Action%'],
    '43681-6': ['%Pharmacodynamics%'],
    '43682-4': ['%Pharmacokinetics%'],
    '34091-9': ['%NONCLINICAL TOXICOLOGY%'],
    '34083-6': ['%Carcinogenesis%'],
    '34092-7': ['%CLINICAL STUDIES%'],
    '34093-5': ['%REFERENCES%'],
    '34069-5': ['%HOW SUPPLIED%'],
    '34076-0': ['%PATIENT COUNSELING%', '%INFORMATION FOR PATIENTS%']
}

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


def _sections_exists(tsquery_sql, section_filters, bag):
    """EXISTS over spl_sections, narrowed strictly by indexed LOINC codes and TSVECTOR search."""
    conditions = ['sec.spl_id = s.spl_id']
    if tsquery_sql:
        conditions.append(f'sec.search_vector @@ {tsquery_sql}')
    if section_filters:
        loincs_set = set()
        for f in section_filters:
            if re.match(r'^[\d.\-]+$', f):
                loincs_set.add(f)
            else:
                clean = re.sub(r'^[0-9]+(\.[0-9]+)*\s*', '', f).strip().upper()
                if clean in TITLE_TO_LOINCS:
                    for l in TITLE_TO_LOINCS[clean]:
                        loincs_set.add(l)
                else:
                    for key, l_list in TITLE_TO_LOINCS.items():
                        if clean and (clean in key or key in clean):
                            for l in l_list:
                                loincs_set.add(l)

        loincs = list(loincs_set)
        if loincs:
            conditions.append(f'sec.loinc_code = ANY({bag.add(loincs)})')
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

    # The EXISTS below is authoritative but unindexable — Postgres cannot use an
    # index for a predicate over unnest(). The redundant ILIKE on the raw column
    # is what lets the pg_trgm index (db_02_init_labeling_schema) narrow the
    # candidate rows first; it over-matches on purpose ('%NDA%' still hits ANDA)
    # and the EXISTS then discards those. Dropping it costs a sequential scan,
    # not correctness.
    broad = [v if '%' in v else f'%{v}%' for v in values]
    return (
        f'({column} ILIKE ANY ({bag.add(broad)}) AND '
        f"EXISTS (SELECT 1 FROM unnest(string_to_array({column}, ';')) AS item "
        f'WHERE btrim(item) ILIKE ANY ({bag.add(values)})))'
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
    raw_sections = _as_list(criterion.get('sections'))
    text = (criterion.get('text') or '').strip()
    mode = criterion.get('mode') or 'simple'

    if not text and not raw_sections:
        return None

    is_product_title = any(s in ('SPLTITLE', 'Product Title') for s in raw_sections)
    is_approval_year = any(s in ('43683-2', 'Initial U.S. Approval [4 Digit Year]') for s in raw_sections)
    other_sections = [s for s in raw_sections if s not in ('SPLTITLE', 'Product Title', '43683-2', 'Initial U.S. Approval [4 Digit Year]')]

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

    # 3. LOINC & Section Title Sections
    if other_sections or (not is_product_title and not is_approval_year):
        tsquery = _tsquery_sql(mode, text, bag)
        sec_pred = _sections_exists(tsquery, other_sections if other_sections else None, bag)
        if sec_pred:
            preds.append(sec_pred)

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
    if 'rs' in values:
        alts.append('s.is_rs = 1')

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
    if not terms:
        return None
    level = (criterion.get('level') or 'pt').lower()
    # Every level expands, PT included: labels write the LLT, so a PT that is
    # not resolved to its descendants matches only the labels that happen to
    # use the PT's own wording. LLT is already the leaf and expands to itself.
    if expand_meddra and level != 'llt':
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
    alts = []
    set_spl_guid = str(criterion.get('setSplGuid') or '').strip()
    appl_kind = str(criterion.get('applKind') or '').strip().upper()
    appl_num = str(criterion.get('applNum') or '').strip()
    unii_code = str(criterion.get('uniiCode') or '').strip().upper()

    if set_spl_guid:
        alts.append(_like_any(['s.set_id', 's.spl_id'], [f'%{set_spl_guid}%'], bag))

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
            f"EXISTS (SELECT 1 FROM labeling.active_ingredients_map aim WHERE aim.spl_id = s.spl_id AND UPPER(aim.unii) = {bag.add(unii_code)})"
        )

    tokens = _merge_application_prefixes(
        [t for t in re.split(r'[\s,;:]+', str(criterion.get('text') or '')) if t]
    )
    unrecognized = []
    for token in tokens:
        if _UUID_RE.match(token):
            alts.append(f'(s.set_id = {bag.add(token)} OR s.spl_id = {bag.add(token)})')
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
            alts.append(
                f"EXISTS (SELECT 1 FROM labeling.active_ingredients_map aim WHERE aim.spl_id = s.spl_id AND UPPER(aim.unii) = {bag.add(token.upper())})"
            )
        else:
            unrecognized.append(token)

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
    is_rld_rs = bool(value.get('isRldRs') or value.get('rld_rs'))
    exclude_repackager = bool(value.get('excludeRepackager') or value.get('exclude_repackager'))

    preds = []
    if is_rld_rs:
        preds.append('(s.is_rld = 1 OR s.is_rs = 1)')

    if exclude_repackager:
        preds.append("(s.marketing_category IS NULL OR (UPPER(s.marketing_category) NOT LIKE '%REPACK%' AND UPPER(s.marketing_category) NOT LIKE '%REPACKAG%'))")

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


def _section_criterion_clause(criterion, bag, warnings, expand_meddra):
    ctype = criterion.get('type')
    value = criterion.get('value') or {}
    
    if ctype == 'fullText':
        tsquery = _tsquery_sql(value.get('mode') or 'simple', value.get('text'), bag)
        if not tsquery:
            return None
        return f'sec.search_vector @@ {tsquery}'

    if ctype == 'labelingSection':
        raw_sections = _as_list(value.get('sections'))
        text = (value.get('text') or '').strip()
        mode = value.get('mode') or 'simple'
        
        # Exclude virtual sections handled at sum_spl level
        other_sections = [s for s in raw_sections if s not in ('SPLTITLE', 'Product Title', '43683-2', 'Initial U.S. Approval [4 Digit Year]')]
        tsquery = _tsquery_sql(mode, text, bag)
        
        conds = []
        if tsquery:
            conds.append(f'sec.search_vector @@ {tsquery}')
        if other_sections:
            loincs_set = set()
            for f in other_sections:
                if re.match(r'^[\d.\-]+$', f):
                    loincs_set.add(f)
                else:
                    clean = re.sub(r'^[0-9]+(\.[0-9]+)*\s*', '', f).strip().upper()
                    if clean in TITLE_TO_LOINCS:
                        for l in TITLE_TO_LOINCS[clean]:
                            loincs_set.add(l)
                    else:
                        for key, l_list in TITLE_TO_LOINCS.items():
                            if clean and (clean in key or key in clean):
                                for l in l_list:
                                    loincs_set.add(l)
            loincs = list(loincs_set)
            if loincs:
                conds.append(f'sec.loinc_code = ANY({bag.add(loincs)})')

        if not conds:
            return None
        return '(' + ' AND '.join(conds) + ')'

    if ctype == 'meddra':
        terms = _as_list(value.get('terms')) or _split_terms(value.get('text'))
        if not terms:
            return None
        level = (value.get('level') or 'pt').lower()
        # Same rule as _c_meddra: everything above LLT expands down to the LLTs,
        # because that is the wording labels actually use. These two paths are
        # both live -- this one runs whenever the query splits into a section
        # half -- so a change to one is wrong unless it is made to both.
        if expand_meddra and level != 'llt':
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
        sec_list = _as_list(value.get('sections'))
        conds = [f'sec.search_vector @@ {tsquery}']
        if sec_list:
            loincs_set = set()
            for f in sec_list:
                if re.match(r'^[\d.\-]+$', f):
                    loincs_set.add(f)
                else:
                    clean = re.sub(r'^[0-9]+(\.[0-9]+)*\s*', '', f).strip().upper()
                    if clean in TITLE_TO_LOINCS:
                        for l in TITLE_TO_LOINCS[clean]:
                            loincs_set.add(l)
            if loincs_set:
                conds.append(f'sec.loinc_code = ANY({bag.add(list(loincs_set))})')
        return '(' + ' AND '.join(conds) + ')'

    return None


SECTION_CRITERION_TYPES = ('fullText', 'labelingSection', 'meddra')

VIRTUAL_SECTIONS = (
    'SPLTITLE', 'Product Title',
    '43683-2', 'Initial U.S. Approval [4 Digit Year]',
)


def _has_virtual_section(query):
    """
    Whether any Labeling Section criterion names a sum_spl-backed pseudo-section.

    Those can't be expressed on the section side, and selecting several sections
    means "any of them" -- an OR that a split across the two halves would turn
    into an AND. Compiling such a criterion whole, on the relational side, is the
    only way to keep the OR.
    """
    for group in (query.get('groups') or []):
        for criterion in (group.get('criteria') or []):
            if criterion.get('type') != 'labelingSection':
                continue
            sections = _as_list((criterion.get('value') or {}).get('sections'))
            if any(s in VIRTUAL_SECTIONS for s in sections):
                return True
    return False


def _has_multi_section_group(query, capabilities):
    """
    Whether any group holds two or more criteria that read section text.

    Those cannot share the section CTE. Its predicates all apply to one
    ``spl_sections`` row, so two criteria in one group would have to be
    satisfied by the *same* section -- and the first one's LOINC filter would
    narrow the second as well. The intent is per-label: a boxed warning
    mentioning one thing and an adverse reactions section mentioning another is
    a match. Only the inline form, one correlated EXISTS per criterion, says
    that.

    fullText drops out of the count when the document-level vector is available,
    since it then compiles to a relational predicate and never touches the CTE.
    """
    fts = bool((capabilities or {}).get('full_fts'))
    for group in (query.get('groups') or []):
        n = 0
        for criterion in (group.get('criteria') or []):
            ctype = criterion.get('type')
            if ctype not in SECTION_CRITERION_TYPES:
                continue
            if ctype == 'fullText' and fts:
                continue
            n += 1
            if n > 1:
                return True
    return False


def _compile_groups(query, bag, warnings, expand_meddra, capabilities, inline_sections):
    """
    Compiles each group to ``(relational_sql, section_sql)``, either of which may
    be None.

    With ``inline_sections`` the section criteria compile to correlated EXISTS
    predicates on the relational side instead, which keeps a group's criteria in
    one boolean expression. See :func:`compile_where` for when that is required.
    """
    compiled = []

    for group in (query.get('groups') or []):
        r_clauses = []
        s_clauses = []

        for criterion in (group.get('criteria') or []):
            ctype = criterion.get('type')
            cval = criterion.get('value') or {}

            if ctype == 'fullText' and capabilities.get('full_fts'):
                # One indexed probe per label against the document-level vector,
                # instead of scanning and de-duplicating N section rows.
                #
                # Whether that column is fully populated is decided once per
                # process by the caller, never per row: `full_search_vector IS
                # NULL` is not GIN-indexable, so OR-ing a fallback in here would
                # push the planner onto a sequential scan of sum_spl and defeat
                # the index this clause exists to use.
                tsquery = _tsquery_sql(cval.get('mode') or 'simple', cval.get('text'), bag)
                if tsquery:
                    r_clauses.append(f'(s.full_search_vector @@ {tsquery})')

            elif ctype in SECTION_CRITERION_TYPES:
                if inline_sections:
                    pred = _compile_criterion(criterion, bag, warnings, expand_meddra, capabilities)
                    if pred:
                        r_clauses.append(pred)
                else:
                    sec_clause = _section_criterion_clause(criterion, bag, warnings, expand_meddra)
                    if sec_clause:
                        s_clauses.append(sec_clause)

            else:
                rel_clause = _compile_criterion(criterion, bag, warnings, expand_meddra, capabilities)
                if rel_clause:
                    r_clauses.append(rel_clause)

        compiled.append((
            '(' + ' AND '.join(r_clauses) + ')' if r_clauses else None,
            '(' + ' AND '.join(s_clauses) + ')' if s_clauses else None,
        ))

    return compiled


def _split_is_faithful(compiled):
    """
    Whether the caller's two-part query preserves the criteria tree's meaning.

    The relational and section halves are handed to the caller separately and
    recombined as ``(R1 OR R2 ...) AND (S1 OR S2 ...)``, but the tree means
    ``(R1 AND S1) OR (R2 AND S2) ...``. Those agree only when at most one group
    contributes, or when every contributing group sits entirely on one side --
    otherwise the split silently ANDs criteria the user asked to OR.
    """
    contributing = [(r, s) for r, s in compiled if r or s]
    if len(contributing) <= 1:
        return True
    return all(s is None for _, s in contributing) or all(r is None for r, _ in contributing)


def compile_where(query, expand_meddra=None, capabilities=None):
    """
    Turns a criteria tree into ``(where_sql, section_where_sql, params, warnings)``.

    ``section_where_sql`` is None when every predicate fits in ``where_sql``.
    """
    capabilities = capabilities or {}

    bag = _ParamBag()
    warnings = []
    inline_sections = _has_virtual_section(query) or _has_multi_section_group(query, capabilities)
    compiled = _compile_groups(
        query, bag, warnings, expand_meddra, capabilities, inline_sections
    )

    if not inline_sections and not _split_is_faithful(compiled):
        # Recompile from scratch -- the discarded pass wrote into `bag`, and the
        # inline form is a different set of parameters, not an addition to it.
        # Correlated EXISTS costs more than the section CTE, but it is the only
        # form that keeps each group's criteria in one expression.
        bag = _ParamBag()
        warnings = []
        compiled = _compile_groups(
            query, bag, warnings, expand_meddra, capabilities, inline_sections=True
        )

    relational_groups = [r for r, _ in compiled if r]
    section_groups = [s for _, s in compiled if s]

    relational_where = ['s.is_latest = TRUE']
    if relational_groups:
        relational_where.append('(' + ' OR '.join(relational_groups) + ')')

    section_where = '(' + ' OR '.join(section_groups) + ')' if section_groups else None

    if not relational_groups and not section_groups:
        warnings.append('No criteria were filled in; showing the most recent labels.')

    return ' AND '.join(relational_where), section_where, bag.params, warnings
