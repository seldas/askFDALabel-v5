"""
Compiles an FDALabel-style criteria tree into high-performance Oracle SQL.

Enforces a two-phase candidate isolation strategy:
1. Relational filters (summary & normalized tables like DGV_SUM_RX_SPL, SUM_SPL_ROUTE,
   SPL_PROD, SUM_SPL_GEN_PROD_ACT_INGR_UNII, SUM_SPL_RLD_RS) and precomputed MedDRA
   occurrences (SPL_SEC_MEDDRA_LLT_OCC) evaluate inside a candidate CTE.
2. Full-text search (CONTAINS over SPL_SEC.CONTENT_XML) is driven by the CTX domain
   index and hash-joined back to the candidate set.

Join key: every detail table in DRUGLABEL keys on SPL_ID (NUMBER). SPL_GUID exists
only on the five summary rollups (DGV_SUM_RX_SPL, DGV_SUM_SPL, DGV_SUM_SPL_PROD,
SUM_SPL, SUM_SPL_GEN_PROD), so it can never appear in a join predicate against
SPL_SEC, SPL_PROD, SUM_SPL_ROUTE, SUM_SPL_RLD_RS or the SUM_SPL_* detail tables.
It is the external identifier only, projected as SPL_ID in the result set.
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


# The two summary rollups a query can be based on.
#
# DGV_SUM_RX_SPL is a curated subset: human labeling only. Anything else --
# animal Rx and OTC above all -- is simply absent from it, so a labelingType
# filter for those matched nothing and the search returned zero rows with no
# explanation. SUM_SPL is the raw rollup and carries everything.
#
# The substitution is safe: every column this compiler reads exists on both.
# SUM_SPL additionally has ACT_MOIETY_NAMES/_UNIIS and MEDDRA_SUPPORTED, and
# DGV_SUM_RX_SPL additionally has FORMAT_GROUP; none of those are read here.
BASE_TABLE_HUMAN = 'druglabel.DGV_SUM_RX_SPL'
BASE_TABLE_ALL = 'druglabel.SUM_SPL'


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
    is_rld_rs = bool(value.get('isRldRs') or value.get('rld_rs'))
    exclude_repackager = bool(value.get('excludeRepackager') or value.get('exclude_repackager'))

    if not values and not is_rld_rs and not exclude_repackager:
        return None

    clauses = []
    if values:
        app_clauses = []
        for v in values:
            v_clean = v.strip().upper()
            if not v_clean:
                continue
            p_contain = bag.add(f'%{v_clean}%')
            p_prefix = bag.add(f'{v_clean} %')
            app_clauses.append(
                f"(UPPER(s.MARKET_CATEGORIES) LIKE {p_contain} OR UPPER(s.APPR_NUM) LIKE {p_prefix} OR UPPER(s.APPR_NUM) LIKE {p_contain})"
            )
        if app_clauses:
            clauses.append('(' + ' OR '.join(app_clauses) + ')')

    if is_rld_rs:
        clauses.append(
            "EXISTS (SELECT 1 FROM druglabel.SUM_SPL_RLD_RS rld WHERE rld.SPL_ID = s.SPL_ID AND (rld.REFERENCE_DRUG = 'Y' OR rld.REFERENCE_STANDARD = 'Y'))"
        )

    if exclude_repackager:
        clauses.append(
            "(UPPER(s.MARKET_CATEGORIES) NOT LIKE '%REPACK%' AND UPPER(s.MARKET_CATEGORIES) NOT LIKE '%REPACKAG%')"
        )

    return '(' + ' AND '.join(clauses) + ')' if clauses else None


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


def _compile_dosage_form(value, bag):
    """
    Dosage form, against the normalized SUM_SPL_DOSAGEFORM rather than the
    delimited DOSAGE_FORMS rollup column.

    The UI sends NCI SPL acceptable terms ("TABLET, FILM COATED"), so the term
    column is matched exactly -- a substring match would make "TABLET" swallow
    every coated, chewable and extended-release variant. NCIT_FORM_CODE is
    accepted too, since it is the leading edge of PK_SUMSPLDFORM after SPL_ID
    and callers may hold a code rather than a term.
    """
    values = _as_list(value.get('values'))
    if not values:
        return None
    clauses = []
    for v in values:
        p = bag.add(v.upper())
        clauses.append(
            'EXISTS (SELECT 1 FROM druglabel.SUM_SPL_DOSAGEFORM df '
            f'WHERE df.SPL_ID = s.SPL_ID AND (UPPER(df.PRODUCT_DOSAGE_FORM_TERM) = {p} '
            f'OR UPPER(df.PRODUCT_NCIT_FORM_CODE) = {p}))'
        )
    return '(' + ' OR '.join(clauses) + ')'


def _compile_dea_schedule(value, bag):
    """
    DEA controlled-substance schedule, via PROD_DEA joined to DEA_SCHEDULE.

    PROD_DEA is per-product and its PK leads with PRODUCT_ID, so SPL_ID is not
    an indexed access path here -- but the table is small relative to SPL_SEC
    and the EXISTS stops at the first hit.

    Both the NCIT code and the SPL acceptable term ("CII", "CIII") are matched,
    since the UI sends terms and callers integrating programmatically may hold
    codes. NCIT_DEA_NAME on PROD_DEA carries the term directly, which avoids
    the join to DEA_SCHEDULE in the common case.
    """
    values = _as_list(value.get('values'))
    if not values:
        return None
    clauses = []
    for v in values:
        p = bag.add(v.upper())
        clauses.append(
            'EXISTS (SELECT 1 FROM druglabel.PROD_DEA dea '
            f'WHERE dea.SPL_ID = s.SPL_ID AND (UPPER(dea.NCIT_DEA_NAME) = {p} '
            f'OR UPPER(dea.NCIT_DEA_CODE) = {p}))'
        )
    return '(' + ' OR '.join(clauses) + ')'


def _compile_active_moiety(value, bag):
    """
    Active moiety, which is not the same thing as active ingredient: the moiety
    is the therapeutically active part of the molecule, so a search for
    "amphetamine" catches its salts where an ingredient search would not.

    SUM_SPL_ACT_MOIETY_NAME and _UNII are the only two tables in DRUGLABEL
    indexed name-first (IX_SUMSPLACTMOIETYNAME_SPLID is on
    (ACTIVE_MOIETY_NAME, SPL_ID)), so an equality or prefix predicate on the
    name is an index range scan rather than a table scan. A bare 'contains'
    would throw that away, so it is only used when the caller asks for it.
    """
    terms = _as_list(value.get('terms')) or _split_terms(value.get('text'))
    if not terms:
        return None
    op = value.get('op') or 'equals'

    clauses = []
    for term in terms:
        t = term.strip().upper()
        if not t:
            continue
        if _UNII_RE.match(t):
            p = bag.add(t)
            clauses.append(
                'EXISTS (SELECT 1 FROM druglabel.SUM_SPL_ACT_MOIETY_UNII mu '
                f'WHERE mu.SPL_ID = s.SPL_ID AND UPPER(mu.ACTIVE_MOIETY_UNII) = {p})'
            )
            continue
        if op == 'contains':
            p = bag.add(f'%{t}%')
            pred = f'UPPER(mn.ACTIVE_MOIETY_NAME) LIKE {p}'
        elif op == 'startsWith':
            p = bag.add(f'{t}%')
            pred = f'UPPER(mn.ACTIVE_MOIETY_NAME) LIKE {p}'
        else:
            p = bag.add(t)
            pred = f'UPPER(mn.ACTIVE_MOIETY_NAME) = {p}'
        clauses.append(
            'EXISTS (SELECT 1 FROM druglabel.SUM_SPL_ACT_MOIETY_NAME mn '
            f'WHERE mn.SPL_ID = s.SPL_ID AND {pred})'
        )
    return '(' + ' OR '.join(clauses) + ')' if clauses else None


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
    status = (value.get('status') or '').strip().lower()
    min_date = (value.get('startDateMin') or '').replace('-', '').strip()
    max_date = (value.get('startDateMax') or '').replace('-', '').strip()
    values = {v.lower() for v in _as_list(value.get('values'))}

    conds = []

    # Status filter
    if status == 'active' or 'marketed' in values:
        conds.append(
            "(mkt.HIGH_DATE IS NULL OR mkt.HIGH_DATE >= TO_CHAR(SYSDATE, 'YYYYMMDD') OR UPPER(mkt.MARKET_STATUS) LIKE '%ACTIVE%')"
        )
    elif status in ('completed', 'discontinued') or 'discontinued' in values:
        conds.append(
            "((mkt.HIGH_DATE IS NOT NULL AND mkt.HIGH_DATE < TO_CHAR(SYSDATE, 'YYYYMMDD')) OR UPPER(mkt.MARKET_STATUS) LIKE '%COMPLETED%' OR UPPER(mkt.MARKET_STATUS) LIKE '%DISCONTINUED%')"
        )
    elif status:
        p_st = bag.add(f'%{status.upper()}%')
        conds.append(f"UPPER(mkt.MARKET_STATUS) LIKE {p_st}")

    # Start Date Min / Max (against LOW_DATE in PROD_MKT_ACT)
    if min_date:
        p_min = bag.add(min_date)
        conds.append(f"mkt.LOW_DATE >= {p_min}")
    if max_date:
        p_max = bag.add(max_date)
        conds.append(f"mkt.LOW_DATE <= {p_max}")

    rld_rs_cond = None
    if 'rld' in values or 'rs' in values:
        alts = []
        if 'rld' in values:
            alts.append("rld.REFERENCE_DRUG = 'Y'")
        if 'rs' in values:
            alts.append("rld.REFERENCE_STANDARD = 'Y'")
        rld_rs_cond = f"EXISTS (SELECT 1 FROM druglabel.SUM_SPL_RLD_RS rld WHERE rld.SPL_ID = s.SPL_ID AND ({' OR '.join(alts)}))"

    if not conds and not rld_rs_cond:
        return None

    res = []
    if conds:
        res.append(
            f"EXISTS (SELECT 1 FROM druglabel.PROD_MKT_ACT mkt WHERE mkt.SPL_ID = s.SPL_ID AND {' AND '.join(conds)})"
        )
    if rld_rs_cond:
        res.append(rld_rs_cond)

    return '(' + ' AND '.join(res) + ')' if res else None


def _compile_meddra(value, bag, expand_meddra=None):
    terms = _as_list(value.get('terms')) or _split_terms(value.get('text'))
    if not terms:
        return None

    level = (value.get('level') or 'pt').lower()
    sections = _as_list(value.get('sections'))

    # Section filter inside SPL_SEC_MEDDRA_LLT_OCC if specified
    sec_clause = ""
    if sections:
        sec_params = [bag.add(s) for s in sections]
        sec_clause = f" AND occ.SEC_TYPE_CODE IN ({', '.join(sec_params)})"

    term_clauses = []
    for term in terms:
        t_clean = str(term).strip()
        if not t_clean:
            continue

        if t_clean.isdigit():
            # Numeric MedDRA Code
            code_num = int(t_clean)
            p_code = bag.add(code_num)
            if level == 'llt':
                llt_subquery = f"SELECT {p_code} FROM DUAL"
            elif level == 'pt':
                llt_subquery = f"SELECT llt.LLT_CODE FROM meddra.low_level_term llt WHERE llt.PT_CODE = {p_code}"
            elif level == 'hlt':
                llt_subquery = (
                    f"SELECT llt.LLT_CODE FROM meddra.low_level_term llt "
                    f"JOIN meddra.meddra_hierarchy mh ON mh.PT_CODE = llt.PT_CODE "
                    f"WHERE mh.HLT_CODE = {p_code}"
                )
            elif level == 'hlgt':
                llt_subquery = (
                    f"SELECT llt.LLT_CODE FROM meddra.low_level_term llt "
                    f"JOIN meddra.meddra_hierarchy mh ON mh.PT_CODE = llt.PT_CODE "
                    f"WHERE mh.HLGT_CODE = {p_code}"
                )
            elif level == 'soc':
                llt_subquery = (
                    f"SELECT llt.LLT_CODE FROM meddra.low_level_term llt "
                    f"JOIN meddra.meddra_hierarchy mh ON mh.PT_CODE = llt.PT_CODE "
                    f"WHERE mh.SOC_CODE = {p_code}"
                )
            else:
                llt_subquery = (
                    f"SELECT llt.LLT_CODE FROM meddra.low_level_term llt "
                    f"LEFT JOIN meddra.meddra_hierarchy mh ON mh.PT_CODE = llt.PT_CODE "
                    f"WHERE llt.LLT_CODE = {p_code} OR llt.PT_CODE = {p_code} "
                    f"OR mh.HLT_CODE = {p_code} OR mh.HLGT_CODE = {p_code} OR mh.SOC_CODE = {p_code}"
                )
        else:
            # Text MedDRA term
            p_pattern = bag.add(f"%{t_clean.upper()}%")
            if level == 'llt':
                llt_subquery = f"SELECT llt.LLT_CODE FROM meddra.low_level_term llt WHERE UPPER(llt.LLT_NAME) LIKE {p_pattern}"
            elif level == 'pt':
                llt_subquery = (
                    f"SELECT llt.LLT_CODE FROM meddra.low_level_term llt "
                    f"JOIN meddra.preferred_term pt ON pt.PT_CODE = llt.PT_CODE "
                    f"WHERE UPPER(pt.PT_NAME) LIKE {p_pattern}"
                )
            elif level == 'hlt':
                llt_subquery = (
                    f"SELECT llt.LLT_CODE FROM meddra.low_level_term llt "
                    f"JOIN meddra.meddra_hierarchy mh ON mh.PT_CODE = llt.PT_CODE "
                    f"WHERE UPPER(mh.HLT_NAME) LIKE {p_pattern}"
                )
            elif level == 'hlgt':
                llt_subquery = (
                    f"SELECT llt.LLT_CODE FROM meddra.low_level_term llt "
                    f"JOIN meddra.meddra_hierarchy mh ON mh.PT_CODE = llt.PT_CODE "
                    f"WHERE UPPER(mh.HLGT_NAME) LIKE {p_pattern}"
                )
            elif level == 'soc':
                llt_subquery = (
                    f"SELECT llt.LLT_CODE FROM meddra.low_level_term llt "
                    f"JOIN meddra.meddra_hierarchy mh ON mh.PT_CODE = llt.PT_CODE "
                    f"WHERE UPPER(mh.SOC_NAME) LIKE {p_pattern} OR UPPER(mh.SOC_ABBREV) LIKE {p_pattern}"
                )
            else:
                llt_subquery = (
                    f"SELECT llt.LLT_CODE FROM meddra.low_level_term llt "
                    f"LEFT JOIN meddra.meddra_hierarchy mh ON mh.PT_CODE = llt.PT_CODE "
                    f"WHERE UPPER(llt.LLT_NAME) LIKE {p_pattern} "
                    f"OR UPPER(mh.PT_NAME) LIKE {p_pattern} "
                    f"OR UPPER(mh.HLT_NAME) LIKE {p_pattern} "
                    f"OR UPPER(mh.HLGT_NAME) LIKE {p_pattern} "
                    f"OR UPPER(mh.SOC_NAME) LIKE {p_pattern}"
                )

        term_clauses.append(
            f"EXISTS (SELECT 1 FROM druglabel.SPL_SEC_MEDDRA_LLT_OCC occ "
            f"WHERE occ.SET_ID = s.SET_ID{sec_clause} AND occ.LLT_CODE IN ({llt_subquery}))"
        )

    return '(' + ' OR '.join(term_clauses) + ')' if term_clauses else None


def _compile_pharm_class(value, bag):
    """
    Pharmacologic class.

    EPC is denormalized onto the summary row, so it stays a direct match on
    s.EPC. The other three class types are not: MoA, PE and CS live in NDF-RT,
    reached by SPL -> active ingredient UNII -> NDF-RT concept:

        SUM_SPL_ACT_INGR_UNII (SPL_ID, UNII)     PK, indexed
          -> INGR_NDFRT_CONCEPT (INGR_UNII, NDFRT_NUI)  PK, indexed
          -> NDFRT_CONCEPT (NUI, NAME, CAT)             PK on NUI

    NDFRT_CONCEPT.CAT holds the class type. Its exact vocabulary is not in the
    schema dump, so CAT is matched with LIKE against the tokens the Postgres
    side uses in substance_indexing.indexing_type ('EPC', 'MoA', 'PE',
    'Chemical'), which is the same source vocabulary. Verify against
    `SELECT DISTINCT CAT FROM DRUGLABEL.NDFRT_CONCEPT` before relying on the
    class-type filter; an unmatched CAT narrows results rather than widening
    them, so a mismatch fails closed.
    """
    terms = _as_list(value.get('terms')) or _split_terms(value.get('text'))
    if not terms:
        return None

    class_type = (value.get('classType') or 'any').lower()

    # 'any' keeps the historical behaviour: EPC only, no NDF-RT join.
    if class_type in ('any', 'epc'):
        clauses = []
        for t in terms:
            p = bag.add(f'%{t.upper()}%')
            clauses.append(f'UPPER(s.EPC) LIKE {p}')
        return '(' + ' OR '.join(clauses) + ')'

    cat_token = {'moa': 'MOA', 'pe': 'PE', 'cs': 'CHEMICAL'}.get(class_type)
    if not cat_token:
        return None
    p_cat = bag.add(f'%{cat_token}%')

    clauses = []
    for t in terms:
        p = bag.add(f'%{t.upper()}%')
        clauses.append(
            'EXISTS (SELECT 1 FROM druglabel.SUM_SPL_ACT_INGR_UNII ai '
            'JOIN druglabel.INGR_NDFRT_CONCEPT inc ON inc.INGR_UNII = ai.UNII '
            'JOIN druglabel.NDFRT_CONCEPT nc ON nc.NUI = inc.NDFRT_NUI '
            f'WHERE ai.SPL_ID = s.SPL_ID AND UPPER(nc.NAME) LIKE {p} '
            f'AND UPPER(nc.CAT) LIKE {p_cat})'
        )
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
            alts.append(f'(s.SET_ID = {p} OR s.SPL_GUID = {p})')
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
            alts.append(f'(UPPER(s.SET_ID) LIKE {p} OR UPPER(s.SPL_GUID) LIKE {p} OR UPPER(s.APPR_NUM) LIKE {p})')

    if not alts:
        return None
    return '(' + ' OR '.join(alts) + ')'


def compile_oracle_query(query, sort=None, direction='desc', limit=50, offset=0, expand_meddra=None,
                         capabilities=None, base_table=BASE_TABLE_HUMAN):
    """
    Compiles an FDALabel criteria tree into an Oracle SQL query with candidate isolation.

    ``base_table`` selects the summary rollup the query is based on -- see
    BASE_TABLE_HUMAN and BASE_TABLE_ALL. Both expose every column read here, so
    it is a straight substitution.

    Returns: (sql_statement, parameters_dict, warnings_list)
    """
    if base_table not in (BASE_TABLE_HUMAN, BASE_TABLE_ALL):
        raise OracleQueryCompileError(f'Unknown base table: {base_table!r}')
    bag = OracleParamBag()
    warnings = []

    # One boolean expression per group, OR-ed at the end.
    group_exprs = []
    # Each text criterion becomes its own CTE of matching SPL_IDs, referenced
    # from the group expression by an IN. See the assembly below for why.
    text_ctes = []
    # Oracle requires every CONTAINS in a statement to carry a distinct label;
    # reusing one raises ORA-29900. Two full-text criteria is enough to hit it.
    contains_label = 0

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
                    contains_label += 1
                    clause = f'CONTAINS(sec.CONTENT_XML, {p}, {contains_label}) > 0'
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
            elif ctype == 'dosageForm':
                c = _compile_dosage_form(cval, bag)
                if c: group_relational.append(c)
            elif ctype == 'deaSchedule':
                c = _compile_dea_schedule(cval, bag)
                if c: group_relational.append(c)
            elif ctype == 'activeMoiety':
                c = _compile_active_moiety(cval, bag)
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
            else:
                warnings.append(f'Unsupported criterion "{ctype}" was ignored.')

        # Each text criterion gets its own CTE and its own membership test, so
        # two of them in one group are satisfied independently -- a label whose
        # Boxed Warning says one thing and whose Adverse Reactions says another
        # matches. Sharing one `sec` row would have required both in the *same*
        # section, and would also have leaked the first criterion's LOINC filter
        # onto the second.
        group_preds = list(group_relational)
        for clause in group_text:
            name = f'text_{len(text_ctes)}'
            text_ctes.append((name, clause))
            group_preds.append(f's.SPL_ID IN (SELECT SPL_ID FROM {name})')

        if group_preds:
            group_exprs.append('(' + ' AND '.join(group_preds) + ')')

    # Groups are alternatives -- the panel draws "OR" between them. They used to
    # be AND-ed, and the relational and text halves were AND-ed independently of
    # each other, so `(R1 AND T1) OR (R2 AND T2)` came out as
    # `R1 AND R2 AND T1 AND T2`.
    where_sql = ' OR '.join(group_exprs) if group_exprs else '1=1'

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
        'spl_id': 'SPL_GUID',
        'epc': 'EPC',
        'unii': 'ACT_INGR_UNIIS',
    }
    sort_column_name = oracle_sort_map.get(str(sort).lower(), 'EFF_TIME')
    sort_dir = 'ASC' if str(direction).lower() == 'asc' else 'DESC'
    order_clause = f"ORDER BY {sort_column_name} {sort_dir} NULLS LAST"

    # Each text criterion is resolved once, on its own, into a set of SPL_IDs.
    #
    # MATERIALIZE matters here: it forces the CTX domain index on CONTENT_XML to
    # drive its own scan exactly once, independent of the candidate set. The
    # alternative -- a correlated EXISTS against SPL_SEC -- would be a full scan
    # per candidate row, because SPL_SEC carries no index on SPL_ID (only
    # PK_SPLSEC on ID). Membership is then a hash semi-join against the
    # materialized set.
    #
    # Only SPL_ID is selected. Deduplicating fifteen VARCHAR2(4000) columns, as
    # this once did, sorts ~60KB rows to remove duplicates a single NUMBER
    # identifies just as well.
    text_cte_sql = ''.join(
        f"""{name} AS (
            SELECT /*+ MATERIALIZE */ DISTINCT sec.SPL_ID
            FROM druglabel.SPL_SEC sec
            WHERE {clause}
        ),
        """
        for name, clause in text_ctes
    )

    # SPL_ID is carried through because it is the only key the detail tables
    # share with the summary rollup; SPL_GUID exists on DGV_SUM_RX_SPL and four
    # sibling rollups, and on nothing else. It is projected as SPL_ID at the very
    # end because the application's "spl_id" is the GUID.
    sql = f"""
        WITH {text_cte_sql}matched AS (
            SELECT s.SPL_ID, s.SPL_GUID, s.SET_ID, s.TITLE, s.PRODUCT_NAMES,
                   s.PRODUCT_NORMD_GENERIC_NAMES, s.AUTHOR_ORG_NORMD_NAME as MANUFACTURER, s.APPR_NUM,
                   s.NDC_CODES, s.EFF_TIME, s.MARKET_CATEGORIES, s.DOCUMENT_TYPE, s.ACT_INGR_NAMES,
                   s.DOSAGE_FORMS, s.ROUTES_OF_ADMINISTRATION as ROUTES, s.EPC, s.ACT_INGR_UNIIS,
                   COUNT(*) OVER () AS TOTAL_COUNT
            FROM {base_table} s
            WHERE {where_sql}
        )
        SELECT p.SET_ID, p.SPL_GUID as SPL_ID, p.PRODUCT_NAMES, p.PRODUCT_NORMD_GENERIC_NAMES as GENERIC_NAMES,
               p.MANUFACTURER, p.APPR_NUM, p.NDC_CODES, p.EFF_TIME as REVISED_DATE,
               p.MARKET_CATEGORIES, p.DOCUMENT_TYPE, p.ACT_INGR_NAMES as ACTIVE_INGREDIENTS,
               p.DOSAGE_FORMS, p.ROUTES, p.EPC,
               (SELECT COUNT(*) FROM druglabel.SUM_SPL_RLD_RS rld WHERE rld.SPL_ID = p.SPL_ID AND rld.REFERENCE_DRUG = 'Y') as IS_RLD,
               p.TOTAL_COUNT,
               p.ACT_INGR_UNIIS as ACTIVE_UNIIS
        FROM matched p
        {order_clause}
        {fetch_clause}
        """

    return sql.strip(), bag.params, warnings
