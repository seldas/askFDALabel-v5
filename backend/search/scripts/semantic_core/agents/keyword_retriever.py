# scripts/semantic_core/agents/keyword_retriever.py
import os
import re
import psycopg2
from psycopg2.extras import RealDictCursor

CLINICAL_CUES = re.compile(
    r"\b(dose|dosing|contraind|warning|precaution|adverse|reaction|"
    r"hepat|liver|alt|ast|bilirubin|boxed|interaction|pregnan|renal|"
    r"monitor|tox|impairment|adjust)\b",
    re.IGNORECASE
)

UUID_RE = re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.I)
NDC_RE = re.compile(r"\b\d{4,5}-\d{3,4}-\d{1,2}\b")
APPR_RE = re.compile(r"\b(NDA|BLA|ANDA)\s*\d+\b", re.I)

def _is_clinicalish(q: str) -> bool:
    return bool(CLINICAL_CUES.search(q or ""))

def run_keyword_retriever(state):
    state.agent_flow.append("keyword_retriever")

    query = (state.conversation.get("user_query") or "").strip()
    intent_type = (state.intent.get("intent") or "").upper()

    database_url = os.getenv("DATABASE_URL")
    candidates = []

    if not query or not database_url:
        state.trace_log.append("KeywordRetriever: Missing query or DATABASE_URL.")
        state.retrieval["results"] = []
        state.flags["next_step"] = "answer_composer"
        return

    try:
        with psycopg2.connect(database_url) as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cursor:

                # NEW: Handle structured filters if present
                if any([state.filters.get("ndcs"), state.filters.get("drugNames"), state.filters.get("adverseEvents")]):
                    where_clauses = []
                    params = []
                    
                    if state.filters.get("ndcs"):
                        ndc_clauses = []
                        for ndc in state.filters["ndcs"]:
                            ndc_clauses.append("ndc_codes LIKE %s")
                            params.append(f"%{ndc}%")
                        where_clauses.append(f"({ ' OR '.join(ndc_clauses) })")
                    
                    if state.filters.get("drugNames"):
                        drug_clauses = []
                        for drug in state.filters["drugNames"]:
                            drug_clauses.append("(product_names ILIKE %s OR generic_names ILIKE %s OR active_ingredients ILIKE %s)")
                            params.extend([f"%{drug}%", f"%{drug}%", f"%{drug}%"])
                        where_clauses.append(f"({ ' OR '.join(drug_clauses) })")

                    # Note: adverseEvents in metadata search is limited to keywords/content if indexed there.
                    # For now, we'll use them as additional keyword filters if they exist.
                    if state.filters.get("adverseEvents"):
                        ae_clauses = []
                        for ae in state.filters["adverseEvents"]:
                            # Full text search placeholder - assuming content_xml or keywords column
                            ae_clauses.append("(product_names ILIKE %s OR generic_names ILIKE %s OR keywords ILIKE %s)")
                            params.extend([f"%{ae}%", f"%{ae}%", f"%{ae}%"])
                        where_clauses.append(f"({ ' AND '.join(ae_clauses) })") # Intersection for AE as requested

                    sql = f"""
                        SELECT set_id, spl_id, product_names, generic_names, is_rld
                        FROM labeling.sum_spl
                        WHERE ({ ' AND '.join(where_clauses) }) AND is_latest = TRUE
                        ORDER BY is_rld DESC
                        LIMIT 20
                    """
                    cursor.execute(sql, tuple(params))

                # IDENTIFIER: prefer exact-ish matches depending on pattern
                elif intent_type == "IDENTIFIER":
                    if UUID_RE.search(query):
                        sql = """
                            SELECT set_id, spl_id, product_names, generic_names, is_rld
                            FROM labeling.sum_spl
                            WHERE set_id = %s AND is_latest = TRUE
                            LIMIT 5
                        """
                        cursor.execute(sql, (query,))
                    elif NDC_RE.search(query):
                        # If you store normalized ndc tokens, use that. Otherwise keep LIKE but tighter.
                        sql = """
                            SELECT set_id, spl_id, product_names, generic_names, is_rld
                            FROM labeling.sum_spl
                            WHERE ndc_codes LIKE %s AND is_latest = TRUE
                            LIMIT 5
                        """
                        cursor.execute(sql, (f"%{query}%",))
                    elif APPR_RE.search(query):
                        sql = """
                            SELECT set_id, spl_id, product_names, generic_names, is_rld
                            FROM labeling.sum_spl
                            WHERE appr_num ILIKE %s AND is_latest = TRUE
                            LIMIT 5
                        """
                        cursor.execute(sql, (f"%{query}%",))
                    else:
                        # conservative fallback
                        sql = """
                            SELECT set_id, spl_id, product_names, generic_names, is_rld
                            FROM labeling.sum_spl
                            WHERE (set_id = %s OR ndc_codes LIKE %s OR appr_num ILIKE %s) AND is_latest = TRUE
                            LIMIT 5
                        """
                        cursor.execute(sql, (query, f"%{query}%", f"%{query}%"))

                else:
                    # ENTITY_LOOKUP: name search + simple relevance ordering
                    sql = """
                        SELECT set_id, spl_id, product_names, generic_names, is_rld
                        FROM labeling.sum_spl
                        WHERE (product_names ILIKE %s OR generic_names ILIKE %s) AND is_latest = TRUE
                        ORDER BY
                            is_rld DESC,
                            CASE WHEN product_names ILIKE %s THEN 1 ELSE 0 END DESC,
                            CASE WHEN generic_names ILIKE %s THEN 1 ELSE 0 END DESC
                        LIMIT 10
                    """
                    # “starts with” gets a boost via ILIKE 'q%'
                    cursor.execute(sql, (f"%{query}%", f"%{query}%", f"{query}%", f"{query}%"))

                rows = cursor.fetchall()

        for r in rows:
            candidates.append({
                "id": r["set_id"],
                "drug_name": r.get("product_names") or r.get("generic_names") or "",
                "section": "Label Metadata",
                "text": f"Found label candidate: {r.get('product_names')}. SetID: {r['set_id']}. SPL_ID: {r['spl_id']}.",
                "score": 1.0,
                "source": {"set_id": r["set_id"], "spl_id": r["spl_id"], "is_rld": r.get("is_rld")}
            })

        state.trace_log.append(f"KeywordRetriever: Found {len(candidates)} direct matches.")
        state.retrieval["results"] = candidates

        # NEW: if query looks clinical, don't stop at metadata—route to semantic constrained to these set_ids
        if intent_type == "ENTITY_LOOKUP" and _is_clinicalish(query) and candidates:
            state.retrieval["plan"] = {
                "pipeline": ["semantic_retriever", "reranker", "postprocess", "evidence_fetcher", "answer_composer"],
                "top_k": state.config.get("top_k", 50),
                "filter_set_ids": [c["id"] for c in candidates[:5]]  # keep it tight
            }
            state.trace_log.append("KeywordRetriever: Clinical cues detected; routing to semantic_retriever with set_id filter.")
            state.flags["next_step"] = "semantic_retriever"
            return

        # Default: discovery result goes to composer
        state.flags["next_step"] = "answer_composer"

    except Exception as e:
        state.trace_log.append(f"KeywordRetriever error: {str(e)}")
        state.retrieval["results"] = []
        state.flags["next_step"] = "answer_composer"