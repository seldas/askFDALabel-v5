Below is a concrete way to extend your script so it handles a much wider set of real user behaviors **and** makes template selection more reliable than “LLM decides, hope it’s right”.

I’ll do three things:

1. **List additional user scenarios** (beyond your 3) and what the system should do.
2. **Propose an expanded planner output schema** (so the LLM can express those scenarios cleanly).
3. **Give you drop‑in code additions/edits** that:

   * add more SQL templates based on the schema you provided (`DRUGLABEL.DGV_SUM_SPL`, `SPL_SEC`, `section_type`, `document_type`, `dgv_sum_spl_act_ingr_name`, `dgv_sum_spl_epc`, `spl_sec_meddra_llt_occ`)
   * add heuristic overrides so you *pick the best template even if the planner is imperfect*
   * add an **aggregate/count mode** (for “how many…”)
   * add a **compare mode** skeleton (two drugs / group comparisons)
   * avoid content retrieval unless truly required

---

## 1) More real user scenarios you should support

### A. Identifier lookups (very common)

Users paste IDs instead of names:

* “Show me label for **Set ID** `7cf67e24-d46b-...`”
* “Look up **SPL_ID 863327**”
* “Find label for **NDC 50242-108**”
* “Find label for **APPR_NUM / NDA / ANDA / BLA** 021436”

**Behavior:** choose identifier template; no LLM needed.

---

### B. Filtered searches (metadata-only)

Examples:

* “Find **Pfizer** labels for **atorvastatin**”
* “Show me **OTC** labels with **oral** route”
* “Find **ANDA** products with **tablet** dosage form”
* “List labels with **initial approval year < 1990**”
* “Most recently revised labels for **metformin**”

**Behavior:** metadata search with strong filters, no section/content retrieval.

---

### C. Content search across whole label vs specific sections

Examples:

* Whole label: “labels that mention **hepatotoxicity**”
* Specific section: “boxed warning mentions **DILI**” / “Warnings & Precautions mentions **QT prolongation**”
* Section discovery: “what section code is **boxed warning**?”

**Behavior:** content search; optionally section-limited using `SPL_SEC.LOINC_CODE`.

---

### D. “How many …” / summary / aggregate questions

Examples:

* “How many drugs have a **boxed warning** mentioning **DILI**?”
* “Top companies with labels mentioning **Stevens‑Johnson**?”
* “Count unique **active ingredients** with **black box warning** about …”
* “How many unique **generic names** appear in labels matching …?”

**Behavior:** run aggregation queries (counts + top breakdowns), optionally provide sample labels (top 5) but don’t fetch full content.

---

### E. Comparison workflows (2 drugs or cohort)

Examples:

* “Compare boxed warnings for **atorvastatin vs simvastatin**”
* “Compare **Warnings and Precautions** across **all rituximab products**”
* “What’s different between **brand vs generic** labels for X?”

**Behavior:** multi-search, pick representative labels (often latest revision per drug), fetch the specific section(s), and have the composer summarize differences.

---

### F. Follow-up queries (multi-turn)

Examples:

* “Show the **boxed warning** for **the first result**”
* “Now only show **OTC** ones”
* “Give me the **Adverse Reactions** section for that Set ID”

**Behavior:** use chat history context:

* extract Set IDs from history text when present
* if user says “that label / first one”, prefer a clarifying question unless you store explicit “last_selected_set_id” in payload

(If you can add a lightweight `payload["context"]["selected_set_id"]`, this gets much easier.)

---

### G. Searches by Active Ingredient and EPC (schema-supported)

Examples:

* “Find labels with active ingredient **rituximab**” (combo products)
* “Search by pharmacologic class **HMG-CoA Reductase Inhibitor**”

**Behavior:** join `dgv_sum_spl_act_ingr_name` and/or `dgv_sum_spl_epc`.

---

### H. MedDRA-occurrence based workflows (schema-supported, power users)

Example:

* “Which labels contain LLT code **10020772** in **Adverse Reactions** section?”

**Behavior:** use `spl_sec_meddra_llt_occ` joined by `SET_ID` and filtered by `SEC_TYPE_CODE`.

---

## 2) Expand planner output so it can express these scenarios

Your planner currently returns something like:

* `intent.type`
* `retrieval.plan_type`
* `retrieval.sql_template_hint`
* `retrieval.search_term`
* `retrieval.content_term`

To support the new scenarios, keep it backward compatible but add:

```json
{
  "intent": {
    "type": "search | qa | aggregate | compare | clarification | chitchat",
    "confidence": 0.0,
    "slots": {
      "set_id": null,
      "spl_id": null,
      "ndc": null,
      "appr_num": null,
      "loinc_codes": [],
      "section_names": [],
      "drug_terms": [],
      "compare_terms": []
    },
    "clarifying_question": ""
  },
  "retrieval": {
    "plan_type": "metadata_only | content_search | section_content | aggregate | compare",
    "sql_template_hint": "",
    "search_terms": [],
    "content_query": "",
    "highlight_terms": [],
    "section_loinc_codes": [],
    "filters": {
      "company": null,
      "market_categories": [],
      "document_types": [],
      "routes": [],
      "dosage_forms": [],
      "epc_terms": [],
      "initial_approval_year_min": null,
      "initial_approval_year_max": null,
      "revised_date_min": null,
      "revised_date_max": null
    },
    "limit": 10,
    "aggregation": {
      "metric": "labels | generics | active_ingredients | companies",
      "group_by": ["generic", "company", "document_type", "epc"],
      "top_n": 10
    }
  }
}
```

Key: **planner doesn’t need to pick the exact template perfectly** if the code can normalize/override based on obvious patterns.

---

## 3) Concrete code changes (drop-in)

### 3.1. Use schema table names from your examples

Your script uses `DGV_SUM_RX_SPL`. The example schema you provided is `DRUGLABEL.DGV_SUM_SPL` etc.

Add at top (Configuration section):

```python
# -----------------------------
# Schema/Table Names (NEW)
# -----------------------------
DB_SCHEMA = os.getenv("FDALABEL_SCHEMA", "DRUGLABEL")

T_DGV_SUM_SPL = f"{DB_SCHEMA}.DGV_SUM_SPL"
T_SPL_SEC = f"{DB_SCHEMA}.SPL_SEC"
T_SECTION_TYPE = f"{DB_SCHEMA}.SECTION_TYPE"
T_DOCUMENT_TYPE = f"{DB_SCHEMA}.DOCUMENT_TYPE"
T_DGV_SUM_SPL_ACT_INGR = f"{DB_SCHEMA}.DGV_SUM_SPL_ACT_INGR_NAME"
T_DGV_SUM_SPL_EPC = f"{DB_SCHEMA}.DGV_SUM_SPL_EPC"
T_SPL_SEC_MEDDRA_LLT_OCC = f"{DB_SCHEMA}.SPL_SEC_MEDDRA_LLT_OCC"
```

This makes it easy to swap schemas.

---

### 3.2. Add robust parsing + heuristic template selection

Drop these helpers near your “Helpers” section:

```python
# -----------------------------
# Heuristic Parsing (NEW)
# -----------------------------
UUID_RE = re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.IGNORECASE)
SPL_ID_RE = re.compile(r"\bSPL[\s_-]*ID\b[:\s]*([0-9]{1,10})\b", re.IGNORECASE)
NDC_RE = re.compile(r"\bNDC\b[:\s]*([0-9]{4,5}-[0-9]{3,4})\b", re.IGNORECASE)
LOINC_RE = re.compile(r"\bLOINC\b[:\s]*([0-9]{4,5}-[0-9])\b", re.IGNORECASE)

COUNT_HINT_RE = re.compile(r"\b(how many|count|number of|total)\b", re.IGNORECASE)
COMPARE_HINT_RE = re.compile(r"\b(compare|difference|vs\.?|versus)\b", re.IGNORECASE)
LIST_SECTIONS_RE = re.compile(r"\b(list|show|what are)\b.*\b(sections|section codes|loinc)\b", re.IGNORECASE)

COMMON_SECTION_ALIASES = {
    "boxed warning": "34066-1",
    "warnings and precautions": "43685-7",
    "warnings": "34071-1",
    "adverse reactions": "34084-4",
    "contraindications": "34070-3",
    "indications": "34067-9",
    "dosage and administration": "34068-7",
}

def extract_first_uuid(text: str) -> Optional[str]:
    m = UUID_RE.search(text or "")
    return m.group(0) if m else None

def extract_spl_id(text: str) -> Optional[int]:
    m = SPL_ID_RE.search(text or "")
    return int(m.group(1)) if m else None

def extract_ndc(text: str) -> Optional[str]:
    m = NDC_RE.search(text or "")
    return m.group(1) if m else None

def extract_loinc(text: str) -> Optional[str]:
    m = LOINC_RE.search(text or "")
    return m.group(1) if m else None

def infer_section_loinc_codes(user_query: str) -> List[str]:
    q = (user_query or "").lower()
    hits = []
    for k, loinc in COMMON_SECTION_ALIASES.items():
        if k in q:
            hits.append(loinc)
    loinc_explicit = extract_loinc(user_query)
    if loinc_explicit:
        hits.append(loinc_explicit)
    # de-dupe preserve order
    seen = set()
    out = []
    for x in hits:
        if x and x not in seen:
            seen.add(x)
            out.append(x)
    return out

def is_count_query(user_query: str) -> bool:
    return bool(COUNT_HINT_RE.search(user_query or ""))

def is_compare_query(user_query: str) -> bool:
    return bool(COMPARE_HINT_RE.search(user_query or ""))

def is_list_sections_query(user_query: str) -> bool:
    return bool(LIST_SECTIONS_RE.search(user_query or ""))
```

**Why this matters:** it prevents “LLM picked wrong template” for the common cases where the intent is obvious (Set ID / NDC / count / compare).

---

### 3.3. Build filter clauses safely (so templates can stay generic)

Add:

```python
# -----------------------------
# SQL clause builders (NEW)
# -----------------------------
def escape_like(term: str) -> str:
    # Escape %, _ and \ for LIKE ... ESCAPE '\'
    return (term or "").replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

def build_or_like_clause(column: str, values: List[str], bind_prefix: str, binds: Dict[str, Any]) -> str:
    """
    Builds something like:
    (UPPER(col) LIKE UPPER(:p0) ESCAPE '\\' OR UPPER(col) LIKE UPPER(:p1) ESCAPE '\\')
    """
    parts = []
    for i, v in enumerate(values or []):
        key = f"{bind_prefix}{i}"
        binds[key] = f"%{escape_like(v)}%"
        parts.append(f"UPPER({column}) LIKE UPPER(:{key}) ESCAPE '\\\\'")
    if not parts:
        return ""
    return "(" + " OR ".join(parts) + ")"

def build_contains_section_clause(section_loinc_codes: List[str], binds: Dict[str, Any]) -> str:
    if not section_loinc_codes:
        return ""
    placeholders = []
    for i, code in enumerate(section_loinc_codes):
        k = f"sec_loinc_{i}"
        binds[k] = code
        placeholders.append(f":{k}")
    return f" AND s.LOINC_CODE IN ({', '.join(placeholders)})"

def build_filters_clause(filters: Dict[str, Any], binds: Dict[str, Any]) -> str:
    """
    Supported filters based on DGV_SUM_SPL schema:
    - company (AUTHOR_ORG_NORMD_NAME)
    - market_categories (MARKET_CATEGORIES)
    - document_types (DOCUMENT_TYPE)
    - routes (ROUTES_OF_ADMINISTRATION)
    - dosage_forms (DOSAGE_FORMS)
    - epc_terms (EPC)
    - initial_approval_year_min/max (INITIAL_APPROVAL_YEAR)
    - revised_date_min/max (REVISED_DATE)
    """
    if not filters:
        return ""

    clauses = []

    company = filters.get("company")
    if company:
        binds["f_company"] = f"%{escape_like(company)}%"
        clauses.append(" AND UPPER(r.AUTHOR_ORG_NORMD_NAME) LIKE UPPER(:f_company) ESCAPE '\\\\'")

    mcats = filters.get("market_categories") or []
    if mcats:
        c = build_or_like_clause("r.MARKET_CATEGORIES", mcats, "f_mcat_", binds)
        if c:
            clauses.append(" AND " + c)

    doctypes = filters.get("document_types") or []
    if doctypes:
        c = build_or_like_clause("r.DOCUMENT_TYPE", doctypes, "f_doctype_", binds)
        if c:
            clauses.append(" AND " + c)

    routes = filters.get("routes") or []
    if routes:
        c = build_or_like_clause("r.ROUTES_OF_ADMINISTRATION", routes, "f_route_", binds)
        if c:
            clauses.append(" AND " + c)

    forms = filters.get("dosage_forms") or []
    if forms:
        c = build_or_like_clause("r.DOSAGE_FORMS", forms, "f_form_", binds)
        if c:
            clauses.append(" AND " + c)

    epc_terms = filters.get("epc_terms") or []
    if epc_terms:
        c = build_or_like_clause("r.EPC", epc_terms, "f_epc_", binds)
        if c:
            clauses.append(" AND " + c)

    y_min = filters.get("initial_approval_year_min")
    y_max = filters.get("initial_approval_year_max")
    if y_min is not None:
        binds["f_ymin"] = int(y_min)
        clauses.append(" AND r.INITIAL_APPROVAL_YEAR >= :f_ymin")
    if y_max is not None:
        binds["f_ymax"] = int(y_max)
        clauses.append(" AND r.INITIAL_APPROVAL_YEAR <= :f_ymax")

    # Date filtering: expect YYYY-MM-DD strings
    rd_min = filters.get("revised_date_min")
    rd_max = filters.get("revised_date_max")
    if rd_min:
        binds["f_rdmin"] = rd_min
        clauses.append(" AND r.REVISED_DATE >= TO_DATE(:f_rdmin, 'YYYY-MM-DD')")
    if rd_max:
        binds["f_rdmax"] = rd_max
        clauses.append(" AND r.REVISED_DATE <= TO_DATE(:f_rdmax, 'YYYY-MM-DD')")

    return "".join(clauses)
```

---

### 3.4. Expand SQL_TEMPLATES for schema-supported scenarios

Replace your `SQL_TEMPLATES` with something like this (still “template-based”, but now covers content-only, identifiers, ingredient/EPC, aggregates, listing sections):

```python
# -----------------------------
# SQL Templates (UPDATED)
# -----------------------------
SQL_TEMPLATES = {
    # 1) Generic metadata search (name/generic search + filters)
    "metadata_search": f"""
        SELECT * FROM (
            SELECT DISTINCT 
                r.SPL_ID, r.SET_ID, r.PRODUCT_NAMES, r.PRODUCT_NORMD_GENERIC_NAMES,
                r.AUTHOR_ORG_NORMD_NAME, r.APPR_NUM, r.ACT_INGR_NAMES, r.MARKET_CATEGORIES,
                r.DOCUMENT_TYPE, r.ROUTES_OF_ADMINISTRATION, r.DOSAGE_FORMS, r.EPC,
                r.NDC_CODES, r.REVISED_DATE, r.INITIAL_APPROVAL_YEAR
            FROM {T_DGV_SUM_SPL} r
            WHERE 1=1
              {{name_clause}}
              {{filters}}
            ORDER BY r.REVISED_DATE DESC NULLS LAST
        ) WHERE ROWNUM <= :limit
    """,

    # 2) Content search across SPL_SEC (optionally section-limited)
    "content_search": f"""
        SELECT * FROM (
            SELECT DISTINCT 
                r.SPL_ID, r.SET_ID, r.PRODUCT_NAMES, r.PRODUCT_NORMD_GENERIC_NAMES,
                r.AUTHOR_ORG_NORMD_NAME, r.APPR_NUM, r.ACT_INGR_NAMES, r.MARKET_CATEGORIES,
                r.DOCUMENT_TYPE, r.ROUTES_OF_ADMINISTRATION, r.DOSAGE_FORMS, r.EPC,
                r.NDC_CODES, r.REVISED_DATE,
                s.LOINC_CODE, s.TITLE AS SECTION_TITLE,
                SCORE(1) AS TEXT_SCORE
            FROM {T_DGV_SUM_SPL} r
            JOIN {T_SPL_SEC} s ON r.SPL_ID = s.SPL_ID
            WHERE 1=1
              {{name_clause}}
              {{filters}}
              AND CONTAINS(s.CONTENT_XML, :content_query, 1) > 0
              {{section_clause}}
            ORDER BY TEXT_SCORE DESC, r.REVISED_DATE DESC NULLS LAST
        ) WHERE ROWNUM <= :limit
    """,

    # 3) Lookup by Set ID
    "search_by_set_id": f"""
        SELECT DISTINCT 
            r.SPL_ID, r.SET_ID, r.PRODUCT_NAMES, r.PRODUCT_NORMD_GENERIC_NAMES,
            r.AUTHOR_ORG_NORMD_NAME, r.APPR_NUM, r.ACT_INGR_NAMES, r.MARKET_CATEGORIES,
            r.DOCUMENT_TYPE, r.ROUTES_OF_ADMINISTRATION, r.DOSAGE_FORMS, r.EPC,
            r.NDC_CODES, r.REVISED_DATE, r.INITIAL_APPROVAL_YEAR
        FROM {T_DGV_SUM_SPL} r
        WHERE r.SET_ID = :set_id
    """,

    # 4) Lookup by SPL_ID
    "search_by_spl_id": f"""
        SELECT DISTINCT 
            r.SPL_ID, r.SET_ID, r.PRODUCT_NAMES, r.PRODUCT_NORMD_GENERIC_NAMES,
            r.AUTHOR_ORG_NORMD_NAME, r.APPR_NUM, r.ACT_INGR_NAMES, r.MARKET_CATEGORIES,
            r.DOCUMENT_TYPE, r.ROUTES_OF_ADMINISTRATION, r.DOSAGE_FORMS, r.EPC,
            r.NDC_CODES, r.REVISED_DATE, r.INITIAL_APPROVAL_YEAR
        FROM {T_DGV_SUM_SPL} r
        WHERE r.SPL_ID = :spl_id
    """,

    # 5) Lookup by NDC (substring match; good enough given "; " separated values)
    "search_by_ndc": f"""
        SELECT * FROM (
            SELECT DISTINCT 
                r.SPL_ID, r.SET_ID, r.PRODUCT_NAMES, r.PRODUCT_NORMD_GENERIC_NAMES,
                r.AUTHOR_ORG_NORMD_NAME, r.APPR_NUM, r.ACT_INGR_NAMES, r.MARKET_CATEGORIES,
                r.DOCUMENT_TYPE, r.ROUTES_OF_ADMINISTRATION, r.DOSAGE_FORMS, r.EPC,
                r.NDC_CODES, r.REVISED_DATE, r.INITIAL_APPROVAL_YEAR
            FROM {T_DGV_SUM_SPL} r
            WHERE 1=1
              AND INSTR(UPPER(r.NDC_CODES), UPPER(:ndc)) > 0
              {{filters}}
            ORDER BY r.REVISED_DATE DESC NULLS LAST
        ) WHERE ROWNUM <= :limit
    """,

    # 6) Search by active ingredient name (normalized table)
    "search_by_active_ingredient": f"""
        SELECT * FROM (
            SELECT DISTINCT 
                r.SPL_ID, r.SET_ID, r.PRODUCT_NAMES, r.PRODUCT_NORMD_GENERIC_NAMES,
                r.AUTHOR_ORG_NORMD_NAME, r.APPR_NUM, r.ACT_INGR_NAMES, r.MARKET_CATEGORIES,
                r.DOCUMENT_TYPE, r.ROUTES_OF_ADMINISTRATION, r.DOSAGE_FORMS, r.EPC,
                r.NDC_CODES, r.REVISED_DATE, r.INITIAL_APPROVAL_YEAR
            FROM {T_DGV_SUM_SPL} r
            JOIN {T_DGV_SUM_SPL_ACT_INGR} ai ON r.SPL_ID = ai.SPL_ID
            WHERE 1=1
              AND UPPER(ai.SUBSTANCE_NAME) LIKE UPPER(:substance) ESCAPE '\\\\'
              {{filters}}
            ORDER BY r.REVISED_DATE DESC NULLS LAST
        ) WHERE ROWNUM <= :limit
    """,

    # 7) Search by EPC (normalized table)
    "search_by_epc": f"""
        SELECT * FROM (
            SELECT DISTINCT 
                r.SPL_ID, r.SET_ID, r.PRODUCT_NAMES, r.PRODUCT_NORMD_GENERIC_NAMES,
                r.AUTHOR_ORG_NORMD_NAME, r.APPR_NUM, r.ACT_INGR_NAMES, r.MARKET_CATEGORIES,
                r.DOCUMENT_TYPE, r.ROUTES_OF_ADMINISTRATION, r.DOSAGE_FORMS, r.EPC,
                r.NDC_CODES, r.REVISED_DATE, r.INITIAL_APPROVAL_YEAR
            FROM {T_DGV_SUM_SPL} r
            JOIN {T_DGV_SUM_SPL_EPC} e ON r.SPL_ID = e.SPL_ID
            WHERE 1=1
              AND UPPER(e.EPC) LIKE UPPER(:epc) ESCAPE '\\\\'
              {{filters}}
            ORDER BY r.REVISED_DATE DESC NULLS LAST
        ) WHERE ROWNUM <= :limit
    """,

    # 8) List sections for a Set ID (for UI + follow-ups)
    "list_sections_for_set_id": f"""
        SELECT DISTINCT
            s.LOINC_CODE, s.TITLE, s.GUID, s.PARENT_SEC_GUID
        FROM {T_SPL_SEC} s
        JOIN {T_DGV_SUM_SPL} r ON r.SPL_ID = s.SPL_ID
        WHERE r.SET_ID = :set_id
        ORDER BY s.LOINC_CODE
    """,

    # 9) Aggregate overview (counts)
    "aggregate_overview": f"""
        SELECT
            COUNT(DISTINCT r.SET_ID) AS LABEL_COUNT,
            COUNT(DISTINCT r.PRODUCT_NORMD_GENERIC_NAMES) AS GENERIC_STR_COUNT,
            COUNT(DISTINCT r.PRODUCT_NAMES) AS PRODUCT_STR_COUNT,
            COUNT(DISTINCT r.AUTHOR_ORG_NORMD_NAME) AS COMPANY_COUNT
        FROM {T_DGV_SUM_SPL} r
        JOIN {T_SPL_SEC} s ON r.SPL_ID = s.SPL_ID
        WHERE 1=1
          {{name_clause}}
          {{filters}}
          AND CONTAINS(s.CONTENT_XML, :content_query, 1) > 0
          {{section_clause}}
    """,

    # 10) Aggregate top generics
    "aggregate_top_generics": f"""
        SELECT * FROM (
            SELECT
                r.PRODUCT_NORMD_GENERIC_NAMES AS GENERIC_NAME,
                COUNT(DISTINCT r.SET_ID) AS LABEL_COUNT
            FROM {T_DGV_SUM_SPL} r
            JOIN {T_SPL_SEC} s ON r.SPL_ID = s.SPL_ID
            WHERE 1=1
              {{name_clause}}
              {{filters}}
              AND CONTAINS(s.CONTENT_XML, :content_query, 1) > 0
              {{section_clause}}
            GROUP BY r.PRODUCT_NORMD_GENERIC_NAMES
            ORDER BY LABEL_COUNT DESC
        ) WHERE ROWNUM <= :limit
    """,

    # 11) Aggregate top companies
    "aggregate_top_companies": f"""
        SELECT * FROM (
            SELECT
                r.AUTHOR_ORG_NORMD_NAME AS COMPANY,
                COUNT(DISTINCT r.SET_ID) AS LABEL_COUNT
            FROM {T_DGV_SUM_SPL} r
            JOIN {T_SPL_SEC} s ON r.SPL_ID = s.SPL_ID
            WHERE 1=1
              {{name_clause}}
              {{filters}}
              AND CONTAINS(s.CONTENT_XML, :content_query, 1) > 0
              {{section_clause}}
            GROUP BY r.AUTHOR_ORG_NORMD_NAME
            ORDER BY LABEL_COUNT DESC
        ) WHERE ROWNUM <= :limit
    """,
}
```

---

### 3.5. Make planner output “safe” and override it when obvious

In `run_planner`, after parsing `plan_data`, add a normalization/override step:

```python
def apply_plan_overrides(state: AgentState):
    q = state.conversation["user_query"] or ""
    hist = state.conversation.get("history") or []

    # Extract identifiers from query (and optionally from history)
    set_id = extract_first_uuid(q)
    spl_id = extract_spl_id(q)
    ndc = extract_ndc(q)

    section_codes = infer_section_loinc_codes(q)

    # Ensure slots exist
    state.intent.setdefault("slots", {})
    state.retrieval.setdefault("plan", {})
    plan = state.retrieval["plan"]

    # Hard overrides: identifiers
    if set_id:
        state.intent["type"] = "search"
        state.intent["slots"]["set_id"] = set_id
        plan["plan_type"] = "metadata_only"
        plan["sql_template_hint"] = "search_by_set_id"
        return

    if spl_id:
        state.intent["type"] = "search"
        state.intent["slots"]["spl_id"] = spl_id
        plan["plan_type"] = "metadata_only"
        plan["sql_template_hint"] = "search_by_spl_id"
        return

    if ndc:
        state.intent["type"] = "search"
        state.intent["slots"]["ndc"] = ndc
        plan["plan_type"] = "metadata_only"
        plan["sql_template_hint"] = "search_by_ndc"
        plan.setdefault("filters", {})
        return

    # Count queries
    if is_count_query(q):
        # If planner didn't set aggregate, force it.
        state.intent["type"] = state.intent.get("type") or "aggregate"
        plan["plan_type"] = "aggregate"
        plan.setdefault("sql_template_hint", "aggregate_overview")
        # Section preference (if specified in query)
        if section_codes:
            plan["section_loinc_codes"] = section_codes

    # Compare queries
    if is_compare_query(q):
        state.intent["type"] = "compare"
        plan["plan_type"] = "compare"
        # Compare flow will run multi-search; SQL template hint is not a single query here.
        plan["sql_template_hint"] = "compare_flow"

    # List sections
    if is_list_sections_query(q) and state.intent.get("slots", {}).get("set_id"):
        plan["plan_type"] = "metadata_only"
        plan["sql_template_hint"] = "list_sections_for_set_id"
```

Then call it inside `run_planner` right after you set `state.intent` and `state.retrieval["plan"]`.

This gives you the best of both worlds:

* LLM extracts “drug terms”, synonyms, filters
* deterministic logic catches obvious cases and prevents wrong templates

---

### 3.6. Update db_executor to support: multiple search_terms, filters, section-limited content

Replace the core of `run_db_executor` with a version that uses `{name_clause}`, `{filters}`, `{section_clause}` placeholders and supports the new plan fields.

Key changes:

* accept `search_terms` list (fallback to single `search_term`)
* content search uses `content_query`
* build filters using `build_filters_clause`
* build section clause using `build_contains_section_clause`

Sketch (drop-in style):

```python
def run_db_executor(state: AgentState):
    logger.info("--- Running DB Executor ---")

    plan = state.retrieval.get("plan", {}) or {}
    template_key = plan.get("sql_template_hint")

    # Back-compat fields
    search_terms = plan.get("search_terms") or []
    if not search_terms and plan.get("search_term"):
        search_terms = [plan.get("search_term")]

    content_query = plan.get("content_query") or plan.get("content_term") or ""
    section_loinc_codes = plan.get("section_loinc_codes") or infer_section_loinc_codes(state.conversation["user_query"])
    filters = plan.get("filters") or {}

    # Limit policy
    limit = plan.get("limit", 10)
    try:
        limit = int(limit)
    except Exception:
        limit = 10
    limit = max(1, min(limit, 50))  # hard safety cap

    # If planner didn’t pick a valid template, choose based on presence of content_query
    if template_key not in SQL_TEMPLATES:
        if content_query:
            template_key = "content_search"
        else:
            template_key = "metadata_search"

    sql_template = SQL_TEMPLATES[template_key]

    binds: Dict[str, Any] = {"limit": limit}

    # name_clause across product_names + generic_names
    name_clause = ""
    if search_terms:
        # Build OR blocks for each term
        or_blocks = []
        for i, term in enumerate(search_terms):
            k = f"q{i}"
            binds[k] = f"%{escape_like(term)}%"
            or_blocks.append(
                f"(UPPER(r.PRODUCT_NAMES) LIKE UPPER(:{k}) ESCAPE '\\\\' "
                f" OR UPPER(r.PRODUCT_NORMD_GENERIC_NAMES) LIKE UPPER(:{k}) ESCAPE '\\\\')"
            )
        name_clause = " AND (" + " OR ".join(or_blocks) + ")"

    # filters
    filters_clause = build_filters_clause(filters, binds)

    # section clause (only used by content/aggregate templates that have alias s)
    section_clause = build_contains_section_clause(section_loinc_codes, binds)

    # content query binding (only needed if template references it)
    if ":content_query" in sql_template:
        binds["content_query"] = content_query or ""  # must exist for CONTAINS

    # identifier binds
    if template_key == "search_by_set_id":
        binds["set_id"] = state.intent.get("slots", {}).get("set_id", "")
    if template_key == "search_by_spl_id":
        binds["spl_id"] = state.intent.get("slots", {}).get("spl_id", "")
    if template_key == "search_by_ndc":
        binds["ndc"] = state.intent.get("slots", {}).get("ndc", "")

    # active ingredient / EPC binds
    if template_key == "search_by_active_ingredient":
        term = (search_terms[0] if search_terms else "") or plan.get("substance_name", "")
        binds["substance"] = f"%{escape_like(term)}%"
    if template_key == "search_by_epc":
        term = (plan.get("epc_term") or (search_terms[0] if search_terms else ""))
        binds["epc"] = f"%{escape_like(term)}%"

    formatted_sql = sql_template.format(
        name_clause=name_clause,
        filters=filters_clause,
        section_clause=section_clause
    )
    state.retrieval["generated_sql"] = formatted_sql

    con = None
    try:
        con = get_db_connection()
        cursor = con.cursor()
        logger.debug(f"Executing SQL: {formatted_sql} with binds {binds}")

        cursor.execute(formatted_sql, binds)
        columns = [col[0] for col in cursor.description]
        cursor.rowfactory = lambda *args: dict(zip(columns, args))

        rows = cursor.fetchall()
        state.retrieval["results"] = rows

        logger.info(f"DB returned {len(rows)} rows.")
        state.trace_log.append(f"DB Executor: Executed '{template_key}' and found {len(rows)} results.")
        state.flags["next_step"] = "postprocess"

    except Exception as e:
        logger.error(f"DB execution error: {e}")
        state.retrieval["error"] = str(e)
        state.trace_log.append(f"DB Executor: Error executing SQL: {str(e)}")
        state.flags["next_step"] = "postprocess"
    finally:
        if con:
            con.close()
```

---

### 3.7. Add an Aggregate Executor (for “how many…”) without full content retrieval

Add a new agent:

```python
def run_aggregate_executor(state: AgentState):
    logger.info("--- Running Aggregate Executor ---")
    plan = state.retrieval.get("plan", {}) or {}

    # inputs
    search_terms = plan.get("search_terms") or ([] if not plan.get("search_term") else [plan.get("search_term")])
    content_query = plan.get("content_query") or plan.get("content_term") or ""
    section_loinc_codes = plan.get("section_loinc_codes") or infer_section_loinc_codes(state.conversation["user_query"])
    filters = plan.get("filters") or {}

    top_n = 10
    agg = (plan.get("aggregation") or {})
    if agg.get("top_n"):
        try:
            top_n = int(agg["top_n"])
        except Exception:
            top_n = 10
    top_n = max(1, min(top_n, 50))

    binds: Dict[str, Any] = {"limit": top_n, "content_query": content_query}

    # clauses
    name_clause = ""
    if search_terms:
        or_blocks = []
        for i, term in enumerate(search_terms):
            k = f"q{i}"
            binds[k] = f"%{escape_like(term)}%"
            or_blocks.append(
                f"(UPPER(r.PRODUCT_NAMES) LIKE UPPER(:{k}) ESCAPE '\\\\' "
                f" OR UPPER(r.PRODUCT_NORMD_GENERIC_NAMES) LIKE UPPER(:{k}) ESCAPE '\\\\')"
            )
        name_clause = " AND (" + " OR ".join(or_blocks) + ")"

    filters_clause = build_filters_clause(filters, binds)
    section_clause = build_contains_section_clause(section_loinc_codes, binds)

    # Run multiple aggregate queries
    con = None
    try:
        con = get_db_connection()
        cursor = con.cursor()

        def run_tpl(key: str) -> List[Dict[str, Any]]:
            sql = SQL_TEMPLATES[key].format(
                name_clause=name_clause,
                filters=filters_clause,
                section_clause=section_clause
            )
            cursor.execute(sql, binds)
            cols = [c[0] for c in cursor.description]
            return [dict(zip(cols, row)) for row in cursor.fetchall()]

        overview = run_tpl("aggregate_overview")
        top_generics = run_tpl("aggregate_top_generics")
        top_companies = run_tpl("aggregate_top_companies")

        state.retrieval["aggregate"] = {
            "overview": overview[0] if overview else {},
            "top_generics": top_generics,
            "top_companies": top_companies,
            "content_query": content_query,
            "section_loinc_codes": section_loinc_codes,
            "filters": filters,
        }
        state.trace_log.append("Aggregate Executor: Computed overview + top generics + top companies.")
        state.flags["next_step"] = "answer_composer"

    except Exception as e:
        logger.error(f"Aggregate execution error: {e}")
        state.retrieval["error"] = str(e)
        state.trace_log.append(f"Aggregate Executor: Error: {str(e)}")
        state.flags["next_step"] = "answer_composer"
    finally:
        if con:
            con.close()
```

Then update controller routing:

```python
elif current_step == "aggregate_executor":
    run_aggregate_executor(state)
```

And in `run_planner`, if intent type is aggregate, route there:

```python
if intent_type == "aggregate":
    state.flags["next_step"] = "aggregate_executor"
```

---

### 3.8. Update postprocess to avoid evidence fetch unless needed

Right now you always fetch evidence for non-metadata plan types. Add a plan flag like `needs_evidence` and default it smartly:

* For aggregate: evidence fetch = false
* For list sections: false
* For QA questions like “Does X mention DILI in boxed warning?”: true

In `run_postprocess`:

```python
plan_type = state.retrieval.get("plan", {}).get("plan_type")

if plan_type == "aggregate":
    state.flags["next_step"] = "answer_composer"
    return

needs_evidence = state.retrieval.get("plan", {}).get("needs_evidence")
if needs_evidence is None:
    # default behavior: only fetch evidence when content search was used
    needs_evidence = (plan_type in ["content_search", "section_content"])

if not needs_evidence:
    state.flags["next_step"] = "answer_composer"
    return

state.flags["next_step"] = "evidence_fetcher"
```

---

### 3.9. Update answer composer to handle aggregate results deterministically

Add at the top of `run_answer_composer`:

```python
if state.retrieval.get("aggregate"):
    agg = state.retrieval["aggregate"]
    ov = agg.get("overview", {})
    top_generics = agg.get("top_generics", [])[:10]
    top_companies = agg.get("top_companies", [])[:10]

    # You can choose to NOT call LLM for this (less hallucination), or call with strict prompt.
    lines = []
    lines.append(f"Search term(s): {state.retrieval.get('plan', {}).get('search_terms') or state.retrieval.get('plan', {}).get('search_term')}")
    lines.append(f"Content query: {agg.get('content_query')}")
    if agg.get("section_loinc_codes"):
        lines.append(f"Section filter (LOINC): {', '.join(agg['section_loinc_codes'])}")

    lines.append("")
    lines.append(f"- Matching labels (distinct Set IDs): {ov.get('LABEL_COUNT', 0)}")
    lines.append(f"- Distinct generic-name strings: {ov.get('GENERIC_STR_COUNT', 0)}")
    lines.append(f"- Distinct product-name strings: {ov.get('PRODUCT_STR_COUNT', 0)}")
    lines.append(f"- Distinct companies: {ov.get('COMPANY_COUNT', 0)}")

    if top_generics:
        lines.append("\nTop generics (by distinct labels):")
        for r in top_generics:
            lines.append(f"  • {r.get('GENERIC_NAME')}: {r.get('LABEL_COUNT')} labels")

    if top_companies:
        lines.append("\nTop companies (by distinct labels):")
        for r in top_companies:
            lines.append(f"  • {r.get('COMPANY')}: {r.get('LABEL_COUNT')} labels")

    state.answer["response_text"] = "\n".join(lines)
    state.trace_log.append("Answer Composer: Returned aggregate summary (no full content fetch).")
    state.flags["next_step"] = "reasoning_generator"
    return
```

This directly satisfies your “how many drugs…” requirement without needing full text retrieval.

---

## 4) Comparison mode: recommended structure (template skeleton)

Comparison is inherently multi-step. The clean way is:

1. For each compare item (drug term), run metadata search → pick best label (most recent revised).
2. Fetch the requested section(s) for each chosen label (only those sections).
3. Summarize differences.

You can add a `run_compare_executor` later; for now, your planner can set `intent.type="compare"` and `plan.plan_type="compare"`, and you route to a compare executor.

**Minimal viable compare plan fields:**

* `compare_terms`: `["atorvastatin", "simvastatin"]`
* `section_loinc_codes`: `["34066-1"]` (boxed warning)
* `needs_evidence=true`

---

## 5) Quick “double-check” of your current template selection issues

### Problem 1: content queries without drug name

Current `search_label_content` *requires* a product LIKE condition. If `search_term` is empty, you set `binds["query"] = "%"`, which “works” but can be very expensive and the planner may not intend it.

**Fix:** separate “content-only search” behavior by using the `content_search` template with an empty `name_clause` (as in the updated approach). It still works, but is clearer and you can add additional gating.

---

### Problem 2: LLM is single point of failure for template choice

Right now, if the planner makes a mistake (e.g., chooses `search_label_metadata` for a “how many…” query), you’ll return a list rather than a count.

**Fix:** the heuristic overrides above prevent this.

---

### Problem 3: evidence fetcher fetches full section XML and then truncates

That’s ok as a prototype, but you should avoid it for:

* metadata-only tasks
* aggregate tasks
* “list sections” tasks

**Fix:** control with `needs_evidence`.

---

## 6) What this buys you immediately

With the changes above you can support:

* ✅ “Labels that contain **DILI** in **boxed warning**” (content_search + section filter)
* ✅ “Compare boxed warnings of **drug A vs drug B**” (skeleton in place; add compare executor)
* ✅ “Drug synonyms / brand vs generic” (planner can output `search_terms=[brand,generic]`, and your SQL now supports multiple terms cleanly)
* ✅ “How many labels mention **DILI** in warnings” (aggregate_overview + top breakdowns)
* ✅ “NDC lookup”, “Set ID lookup”, “SPL_ID lookup”
* ✅ “Search by active ingredient” and “search by EPC class”

---

If you want, I can also provide a **revised PLANNER_PROMPT** (with explicit examples for each plan_type and a strict JSON schema) so the LLM produces consistent `search_terms`, `content_query`, `filters`, `aggregation` blocks that match the code above.
