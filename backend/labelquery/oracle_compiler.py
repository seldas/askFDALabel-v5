"""
Compiles an FDALabel-style criteria tree into high-performance Oracle SQL.

Enforces a 5-tier relational candidate isolation strategy:
1. Relational filters (summary & normalized tables like DGV_SUM_RX_SPL, SUM_SPL_ROUTE,
   SPL_PROD, SUM_SPL_GEN_PROD_ACT_INGR_UNII, SUM_SPL_RLD_RS) and precomputed MedDRA 
   occurrences (SPL_SEC_MEDDRA_LLT_OCC) evaluate inside a candidate CTE.
2. Full-text search (CONTAINS over SPL_SEC.CONTENT_XML) evaluates ONLY against candidate 
   SPL_IDs, preventing expensive domain index scans across the full database.
"""

import re
from .compiler import TITLE_TO_LOINCS

_PRODUCT_NAME_COLUMNS = {
    'trade': ['p.NAME'],
    'generic': ['p.NORMD_GENERIC_NAME'],
    'any': ['p.NAME', 'p.NORMD_GENERIC_NAME', 's.ACT_INGR_NAMES'],
}

_UUID_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.I)
_NDC_RE = re.compile(r'^\d{4,5}-\d{3,4}(-\d{1,2})?$')
_APPL_RE = re.compile(r'^\d{3,6}$')
_UNII_RE = re.compile(r'^[0-9A-Z]{10}$')
_APPL_PREFIXES = ('ANADA', 'ANDA', 'NADA', 'BLA', 'NDA')
_PREFIXED_APPL_RE = re.compile(r'^(' + '|'.join(_APPL_PREFIXES) + r')[\s-]*(\d{3,6})$', re.I)


class OracleQueryCompileError(ValueError):
    """Raised for a criterion the Oracle compiler cannot compile into valid SQL."""


class OracleParamBag:
    """Manages parameter names (:p1, :p2, ...) for Oracle queries."""

    def __init__(self):
        self.params = {}
        self._n = 0

    def add(self, value):
        self._n += 1
        key = f'p{self._n}'
        self.params[key] = value
        return f':{key}'


def _split_terms(text):
    if not text:
        return []
    return [t.strip() for t in re.split(r'[;,\n]', str(text)) if t.strip()]


def _as_list(value):
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return [str(v).strip() for v in value if str(v).strip()]
    return [str(value).strip()] if str(value).strip() else []


def _format_contains_query(text, mode='simple'):
    """Formats text into an Oracle CONTAINS query string."""
    text = (text or '').strip()
    if not text:
        return ''
    
    if mode == 'advanced':
        # Replace AND/OR/NOT operators while wrapping search terms in braces {}
        words = text.split()
        out = []
        for w in words:
            up = w.upper()
            if up in ('AND', 'OR', 'NOT', '&', '|', '!'):
                out.append(up)
            else:
                clean_w = w.strip('()"{}"')
                if clean_w:
                    out.append(f'{{{clean_w}}}')
        return ' '.join(out)
    else:
        # Simple phrase mode: wrap individual words or whole phrase in braces
        words = [w.strip('()"{}"') for w in text.split() if w.strip()]
        if not words:
            return ''
        return ' AND '.join([f'{{{w}}}' for w in words])


# ---------------------------------------------------------------------------
# Criterion Compilers (Oracle Relational Candidates)
# ---------------------------------------------------------------------------

def _compile_labeling_type(value, bag):
    values = _as_list(value.get('values'))
    if not values:
        return None
    clauses = []
    for v in values:
        p = bag.add(f'%{v.upper()}%')
        clauses.append(f'UPPER(s.DOCUMENT_TYPE) LIKE {p}')
    return '(' + ' OR '.join(clauses) + ')'


def _compile_application_type(value, bag):
    values = _as_list(value.get('values'))
    if not values:
        return None
    clauses = []
    for v in values:
        v_clean = v.strip().upper()
        if not v_clean:
            continue
        p_contain = bag.add(f'%{v_clean}%')
        p_prefix = bag.add(f'{v_clean} %')
        clauses.append(
            f"(UPPER(s.MARKET_CATEGORIES) LIKE {p_contain} OR UPPER(s.APPR_NUM) LIKE {p_prefix} OR UPPER(s.APPR_NUM) LIKE {p_contain})"
        )
    return '(' + ' OR '.join(clauses) + ')' if clauses else None


def _compile_route(value, bag):
    values = _as_list(value.get('values'))
    if not values:
        return None
    clauses = []
    for v in values:
        p = bag.add(f'%{v.upper()}%')
        clauses.append(
            'EXISTS (SELECT 1 FROM druglabel.SUM_SPL_ROUTE r '
            f'WHERE r.SPL_ID = s.SPL_ID AND (UPPER(r.ROUTE_SPL_ACCEPTABLE_TERM) LIKE {p} '
            f'OR UPPER(r.NCIT_ROUTE_OF_ADMIN_CODE) LIKE {p}))'
        )
    return '(' + ' OR '.join(clauses) + ')'


def _compile_product_name(value, bag):
    field = value.get('field') or 'any'
    op = value.get('op') or 'contains'
    terms = _split_terms(value.get('text'))
    if not terms:
        return None

    clauses = []
    for term in terms:
        term_up = term.upper()
        if op == 'equals':
            pat = term_up
        elif op == 'startsWith':
            pat = f'{term_up}%'
        else:
            pat = f'%{term_up}%'
        p = bag.add(pat)

        if field == 'trade':
            sub = f'UPPER(p.NAME) LIKE {p}'
        elif field == 'generic':
            sub = f'UPPER(p.NORMD_GENERIC_NAME) LIKE {p}'
        else:
            sub = f'(UPPER(p.NAME) LIKE {p} OR UPPER(p.NORMD_GENERIC_NAME) LIKE {p} OR UPPER(s.ACT_INGR_NAMES) LIKE {p})'

        if op == 'notContains':
            clauses.append(
                'NOT EXISTS (SELECT 1 FROM druglabel.SPL_PROD p WHERE p.SPL_ID = s.SPL_ID AND ' + sub + ')'
            )
        else:
            clauses.append(
                'EXISTS (SELECT 1 FROM druglabel.SPL_PROD p WHERE p.SPL_ID = s.SPL_ID AND ' + sub + ')'
            )
    return '(' + ' AND '.join(clauses) + ')'


def _compile_market_status(value, bag):
    values = {v.lower() for v in _as_list(value.get('values'))}
    if not values:
        return None
    alts = []
    if 'rld' in values:
        alts.append(
            'EXISTS (SELECT 1 FROM druglabel.SUM_SPL_RLD_RS rld WHERE rld.SPL_ID = s.SPL_ID AND rld.REFERENCE_DRUG = \'Y\')'
        )
    if 'rs' in values:
        alts.append(
            'EXISTS (SELECT 1 FROM druglabel.SUM_SPL_RLD_RS rld WHERE rld.SPL_ID = s.SPL_ID AND rld.REFERENCE_STANDARD = \'Y\')'
        )
    if 'marketed' in values or 'discontinued' in values:
        alts.append(
            'EXISTS (SELECT 1 FROM druglabel.SUM_SPL_RLD_RS rld WHERE rld.SPL_ID = s.SPL_ID AND rld.APPL_NO IS NOT NULL)'
        )
    if not alts:
        return None
    return '(' + ' OR '.join(alts) + ')'


def _compile_meddra(value, bag, expand_meddra=None):
    terms = _as_list(value.get('terms')) or _split_terms(value.get('text'))
    if not terms:
        return None
    
    # We query druglabel.SPL_SEC_MEDDRA_LLT_OCC by set_id / llt_code if LLT codes available
    clauses = []
    for term in terms:
        p = bag.add(f'%{term.upper()}%')
        clauses.append(
            'EXISTS (SELECT 1 FROM druglabel.SPL_SEC_MEDDRA_LLT_OCC occ WHERE occ.SET_ID = s.SET_ID '
            f'AND (UPPER(occ.LLT_CODE) LIKE {p} OR UPPER(occ.SEC_TYPE_CODE) LIKE {p}))'
        )
    return '(' + ' OR '.join(clauses) + ')'


def _compile_pharm_class(value, bag):
    terms = _as_list(value.get('terms')) or _split_terms(value.get('text'))
    if not terms:
        return None
    clauses = []
    for t in terms:
        p = bag.add(f'%{t.upper()}%')
        clauses.append(f'UPPER(s.EPC) LIKE {p}')
    return '(' + ' OR '.join(clauses) + ')'


def _compile_identifier(value, bag):
    tokens = _as_list(value.get('text')) or _split_terms(value.get('text'))
    if not tokens:
        return None
    alts = []
    for token in tokens:
        token_str = token.strip()
        if _UUID_RE.match(token_str):
            p = bag.add(token_str)
            alts.append(f'(s.SET_ID = {p} OR s.SPL_ID = {p})')
        elif _NDC_RE.match(token_str):
            parts = token_str.split('-')
            base = parts[0] + parts[1]
            p = bag.add(f'%{base}%')
            alts.append(f"REPLACE(s.NDC_CODES, '-', '') LIKE {p}")
        elif _UNII_RE.match(token_str):
            p = bag.add(token_str.upper())
            alts.append(
                'EXISTS (SELECT 1 FROM druglabel.SUM_SPL_GEN_PROD_ACT_INGR_UNII ing '
                f'WHERE ing.SPL_ID = s.SPL_ID AND UPPER(ing.UNII) = {p})'
            )
        elif _PREFIXED_APPL_RE.match(token_str):
            kind, number = _PREFIXED_APPL_RE.match(token_str).groups()
            p1 = bag.add(f'%{kind.upper()} {number.zfill(6)}%')
            p2 = bag.add(f'%{kind.upper()} {number}%')
            alts.append(f'(UPPER(s.APPR_NUM) LIKE {p1} OR UPPER(s.APPR_NUM) LIKE {p2})')
        elif _APPL_RE.match(token_str):
            padded = token_str.zfill(6)
            p1 = bag.add(f'%{padded}%')
            p2 = bag.add(f'%{token_str}%')
            alts.append(f'(s.APPR_NUM LIKE {p1} OR s.APPR_NUM LIKE {p2})')
        else:
            p = bag.add(f'%{token_str.upper()}%')
            alts.append(f'(UPPER(s.SET_ID) LIKE {p} OR UPPER(s.SPL_ID) LIKE {p} OR UPPER(s.APPR_NUM) LIKE {p})')

    if not alts:
        return None
    return '(' + ' OR '.join(alts) + ')'


def compile_oracle_query(query, sort=None, direction='desc', limit=50, offset=0, expand_meddra=None, capabilities=None):
    """
    Compiles an FDALabel criteria tree into an Oracle SQL query with candidate isolation.
    
    Returns: (sql_statement, parameters_dict, warnings_list)
    """
    bag = OracleParamBag()
    warnings = []
    
    relational_clauses = []
    text_clauses = []

    for group in (query.get('groups') or []):
        group_relational = []
        group_text = []
        for criterion in (group.get('criteria') or []):
            ctype = criterion.get('type')
            cval = criterion.get('value') or {}

            if ctype in ('fullText', 'labelingSection'):
                # Text matching using Oracle Text CONTAINS over SPL_SEC
                mode = cval.get('mode') or 'simple'
                text_query = _format_contains_query(cval.get('text'), mode)
                sections = _as_list(cval.get('sections'))
                
                if text_query:
                    p = bag.add(text_query)
                    clause = f'CONTAINS(sec.CONTENT_XML, {p}, 1) > 0'
                    if sections:
                        sec_loincs_set = set()
                        for s in sections:
                            if s in ('SPLTITLE', '43683-2'):
                                continue
                            if re.match(r'^[\d.\-]+$', s):
                                sec_loincs_set.add(s)
                            else:
                                clean = re.sub(r'^[0-9]+(\.[0-9]+)*\s*', '', s).strip().upper()
                                if clean in TITLE_TO_LOINCS:
                                    for l in TITLE_TO_LOINCS[clean]:
                                        sec_loincs_set.add(l)
                                else:
                                    sec_loincs_set.add(s)
                        if sec_loincs_set:
                            loinc_preds = [f'sec.LOINC_CODE = {bag.add(l)}' for l in sec_loincs_set]
                            clause += f' AND ({" OR ".join(loinc_preds)})'
                    group_text.append(clause)
            elif ctype == 'labelingType':
                c = _compile_labeling_type(cval, bag)
                if c: group_relational.append(c)
            elif ctype == 'applicationType':
                c = _compile_application_type(cval, bag)
                if c: group_relational.append(c)
            elif ctype == 'route':
                c = _compile_route(cval, bag)
                if c: group_relational.append(c)
            elif ctype == 'productName':
                c = _compile_product_name(cval, bag)
                if c: group_relational.append(c)
            elif ctype == 'marketStatus':
                c = _compile_market_status(cval, bag)
                if c: group_relational.append(c)
            elif ctype == 'meddra':
                c = _compile_meddra(cval, bag, expand_meddra)
                if c: group_relational.append(c)
            elif ctype == 'pharmClass':
                c = _compile_pharm_class(cval, bag)
                if c: group_relational.append(c)
            elif ctype == 'identifier':
                c = _compile_identifier(cval, bag)
                if c: group_relational.append(c)

        if group_relational:
            relational_clauses.append('(' + ' AND '.join(group_relational) + ')')
        if group_text:
            text_clauses.append('(' + ' AND '.join(group_text) + ')')

    # Formulate Candidate Isolation SQL
    relational_where = ' AND '.join(relational_clauses) if relational_clauses else '1=1'
    
    if limit is not None:
        p_offset = bag.add(offset)
        p_limit = bag.add(limit)
        fetch_clause = f"OFFSET {p_offset} ROWS FETCH NEXT {p_limit} ROWS ONLY"
    else:
        fetch_clause = ""

    # Sort mapping
    oracle_sort_map = {
        'product': 'PRODUCT_NAMES',
        'generic': 'PRODUCT_NORMD_GENERIC_NAMES',
        'manufacturer': 'MANUFACTURER',
        'appr_num': 'APPR_NUM',
        'market_category': 'MARKET_CATEGORIES',
        'doc_type': 'DOCUMENT_TYPE',
        'dosage_form': 'DOSAGE_FORMS',
        'route': 'ROUTES',
        'revised_date': 'EFF_TIME',
        'approval_year': 'EFF_TIME',
        'set_id': 'SET_ID',
        'spl_id': 'SPL_ID',
        'epc': 'EPC',
        'unii': 'ACT_INGR_UNIIS',
    }
    sort_column_name = oracle_sort_map.get(str(sort).lower(), 'EFF_TIME')
    sort_dir = 'ASC' if str(direction).lower() == 'asc' else 'DESC'
    order_clause = f"ORDER BY {sort_column_name} {sort_dir} NULLS LAST"

    if text_clauses:
        # Phase 1: Candidate Isolation CTE -> Phase 2: CONTAINS text search -> Phase 3: Total Count & Paged RLD lookup
        text_where = ' AND '.join(text_clauses)
        sql = f"""
        WITH candidate_labels AS (
            SELECT /*+ INLINE NO_MERGE */ s.SPL_ID, s.SET_ID, s.TITLE, s.PRODUCT_NAMES, s.PRODUCT_NORMD_GENERIC_NAMES,
                   s.AUTHOR_ORG_NORMD_NAME as MANUFACTURER, s.APPR_NUM, s.NDC_CODES, s.EFF_TIME, s.MARKET_CATEGORIES,
                   s.DOCUMENT_TYPE, s.ACT_INGR_NAMES, s.DOSAGE_FORMS, s.ROUTES_OF_ADMINISTRATION as ROUTES, s.EPC,
                   s.ACT_INGR_UNIIS
            FROM druglabel.DGV_SUM_RX_SPL s
            WHERE {relational_where}
        ),
        matched_sections AS (
            SELECT /*+ LEADING(c sec) USE_NL(sec) */ DISTINCT
                   c.SPL_ID, c.SET_ID, c.PRODUCT_NAMES, c.PRODUCT_NORMD_GENERIC_NAMES, c.MANUFACTURER,
                   c.APPR_NUM, c.NDC_CODES, c.EFF_TIME, c.MARKET_CATEGORIES, c.DOCUMENT_TYPE,
                   c.ACT_INGR_NAMES, c.DOSAGE_FORMS, c.ROUTES, c.EPC, c.ACT_INGR_UNIIS
            FROM candidate_labels c
            INNER JOIN druglabel.SPL_SEC sec ON sec.SPL_ID = c.SPL_ID
            WHERE {text_where}
        ),
        total_cnt AS (
            SELECT COUNT(*) AS total_count FROM matched_sections
        ),
        paged_matched AS (
            SELECT m.*
            FROM matched_sections m
            {order_clause}
            {fetch_clause}
        )
        SELECT p.SET_ID, p.SPL_ID, p.PRODUCT_NAMES, p.PRODUCT_NORMD_GENERIC_NAMES as GENERIC_NAMES,
               p.MANUFACTURER, p.APPR_NUM, p.NDC_CODES, p.EFF_TIME as REVISED_DATE,
               p.MARKET_CATEGORIES, p.DOCUMENT_TYPE, p.ACT_INGR_NAMES as ACTIVE_INGREDIENTS,
               p.DOSAGE_FORMS, p.ROUTES, p.EPC,
               (SELECT COUNT(*) FROM druglabel.SUM_SPL_RLD_RS rld WHERE rld.SPL_ID = p.SPL_ID AND rld.REFERENCE_DRUG = 'Y') as IS_RLD,
               t.total_count,
               p.ACT_INGR_UNIIS as ACTIVE_UNIIS
        FROM total_cnt t
        LEFT JOIN paged_matched p ON 1=1
        """
    else:
        # Fast Relational Only Query -> Total Count & Paged RLD lookup
        sql = f"""
        WITH candidate_labels AS (
            SELECT /*+ INLINE NO_MERGE */ s.SPL_ID, s.SET_ID, s.TITLE, s.PRODUCT_NAMES, s.PRODUCT_NORMD_GENERIC_NAMES,
                   s.AUTHOR_ORG_NORMD_NAME as MANUFACTURER, s.APPR_NUM, s.NDC_CODES, s.EFF_TIME, s.MARKET_CATEGORIES,
                   s.DOCUMENT_TYPE, s.ACT_INGR_NAMES, s.DOSAGE_FORMS, s.ROUTES_OF_ADMINISTRATION as ROUTES, s.EPC,
                   s.ACT_INGR_UNIIS
            FROM druglabel.DGV_SUM_RX_SPL s
            WHERE {relational_where}
        ),
        total_cnt AS (
            SELECT COUNT(*) AS total_count FROM candidate_labels
        ),
        paged_candidates AS (
            SELECT c.*
            FROM candidate_labels c
            {order_clause}
            {fetch_clause}
        )
        SELECT p.SET_ID, p.SPL_ID, p.PRODUCT_NAMES, p.PRODUCT_NORMD_GENERIC_NAMES as GENERIC_NAMES,
               p.MANUFACTURER, p.APPR_NUM, p.NDC_CODES, p.EFF_TIME as REVISED_DATE,
               p.MARKET_CATEGORIES, p.DOCUMENT_TYPE, p.ACT_INGR_NAMES as ACTIVE_INGREDIENTS,
               p.DOSAGE_FORMS, p.ROUTES, p.EPC,
               (SELECT COUNT(*) FROM druglabel.SUM_SPL_RLD_RS rld WHERE rld.SPL_ID = p.SPL_ID AND rld.REFERENCE_DRUG = 'Y') as IS_RLD,
               t.total_count,
               p.ACT_INGR_UNIIS as ACTIVE_UNIIS
        FROM total_cnt t
        LEFT JOIN paged_candidates p ON 1=1
        """

    return sql.strip(), bag.params, warnings
