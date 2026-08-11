# scripts/semantic_core/agents/semantic_retriever.py
import os
import psycopg2
from psycopg2.extras import RealDictCursor

def _normalize_set_id_filter(val):
    """
    Normalize filter_set_ids to a small list[str].
    Accepts list/tuple/set or a single string.
    """
    if not val:
        return []
    if isinstance(val, str):
        return [val]
    if isinstance(val, (list, tuple, set)):
        out = []
        for x in val:
            if not x:
                continue
            out.append(str(x))
        # de-dupe while preserving order
        seen = set()
        out2 = []
        for x in out:
            if x in seen:
                continue
            seen.add(x)
            out2.append(x)
        return out2
    return [str(val)]

def _clamp01(x: float) -> float:
    if x < 0.0:
        return 0.0
    if x > 1.0:
        return 1.0
    return x

def run_semantic_retriever(state):
    state.trace_log.append("SemanticRetriever: spl_sections table disabled for local PG database; skipping semantic retrieval.")
    state.retrieval = state.retrieval or {}
    state.retrieval["results"] = []
    state.flags["next_step"] = "reranker"
    return

    # Optional constraints passed from keyword_retriever/planner/controller
    filter_set_ids = _normalize_set_id_filter(plan.get("filter_set_ids"))
    per_label_k = int(plan.get("per_label_k", 3) or 3)

    # Optional quality knobs
    min_chunk_len = int(plan.get("min_chunk_len", 50) or 50)
    include_sections = plan.get("include_sections")  # list[str] or None
    exclude_sections = plan.get("exclude_sections")  # list[str] or None

    where_clauses = [
        "e.content_xml IS NOT NULL",
        "length(e.content_xml) >= %(min_chunk_len)s",
    ]

    import re
    clean_query = re.sub(r"[^\w\s]", " ", query).strip()
    if not clean_query:
        clean_query = query

    params = {
        "qv": query_emb,
        "clean_query": clean_query,
        "top_k": top_k,
        "per_label_k": per_label_k,
        "min_chunk_len": min_chunk_len,
    }

    # Add set_id filter if provided
    if filter_set_ids:
        where_clauses.append("lbl.set_id = ANY(%(filter_set_ids)s)")
        params["filter_set_ids"] = filter_set_ids

    # Optional: section filtering (case-insensitive match)
    # NOTE: adjust column name if you store section path vs title
    if include_sections:
        params["include_sections"] = [str(x) for x in include_sections if x]
        where_clauses.append("lower(e.title) = ANY(%(include_sections)s)")
        # Caller should pass include_sections already lowercased for best results.
    if exclude_sections:
        params["exclude_sections"] = [str(x) for x in exclude_sections if x]
        where_clauses.append("NOT (lower(e.title) = ANY(%(exclude_sections)s))")

    where_sql = " AND ".join(where_clauses)

    state.trace_log.append("SemanticRetriever: FTS search on spl_sections initialized.")
    search_sql = f"""
        WITH base AS (
            SELECT
                e.id,
                lbl.set_id,
                e.spl_id,
                e.title AS section,
                e.content_xml AS text,
                (1.0 / (1.0 + ts_rank_cd(
                    e.search_vector,
                    plainto_tsquery('english', %(clean_query)s)
                ))) AS dist
            FROM labeling.spl_sections e
            JOIN labeling.sum_spl lbl ON e.spl_id = lbl.spl_id
            WHERE {where_sql}
              AND e.search_vector @@ plainto_tsquery('english', %(clean_query)s)
        ),
        ranked AS (
            SELECT
                b.*,
                ROW_NUMBER() OVER (
                    PARTITION BY b.set_id
                    ORDER BY b.dist ASC
                ) AS rn
            FROM base b
        )
        SELECT
            r.id,
            s.product_names AS drug_name,
            r.section,
            r.text,
            (1.0 - r.dist) AS raw_score,
            r.set_id,
            r.spl_id
        FROM ranked r
        JOIN labeling.sum_spl s ON r.spl_id = s.spl_id
        WHERE r.rn <= %(per_label_k)s
        ORDER BY r.dist ASC
        LIMIT %(top_k)s
    """

    candidates = []
    try:
        with psycopg2.connect(database_url) as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                try:
                    cursor.execute(search_sql, params)
                    rows = cursor.fetchall()
                except Exception as fts_err:
                    state.trace_log.append(f"SemanticRetriever: FTS search error: {str(fts_err)}. Trying simpler fallback.")
                    rows = []
                
                if not rows and filter_set_ids:
                    state.trace_log.append("SemanticRetriever: FTS returned 0 results. Fetching default chunks for filter_set_ids.")
                    fallback_sql = f"""
                        WITH base AS (
                            SELECT
                                e.id,
                                lbl.set_id,
                                e.spl_id,
                                e.title AS section,
                                e.content_xml AS text,
                                0.5 AS dist
                            FROM labeling.spl_sections e
                            JOIN labeling.sum_spl lbl ON e.spl_id = lbl.spl_id
                            WHERE e.content_xml IS NOT NULL
                              AND length(e.content_xml) >= %(min_chunk_len)s
                              AND lbl.set_id = ANY(%(filter_set_ids)s)
                        ),
                        ranked AS (
                            SELECT
                                b.*,
                                ROW_NUMBER() OVER (
                                    PARTITION BY b.set_id
                                    ORDER BY b.id ASC
                                ) AS rn
                            FROM base b
                        )
                        SELECT
                            r.id,
                            s.product_names AS drug_name,
                            r.section,
                            r.text,
                            0.5 AS raw_score,
                            r.set_id,
                            r.spl_id
                        FROM ranked r
                        JOIN labeling.sum_spl s ON r.spl_id = s.spl_id
                        WHERE r.rn <= %(per_label_k)s
                        ORDER BY r.set_id, r.rn
                        LIMIT %(top_k)s
                    """
                    cursor.execute(fallback_sql, params)
                    rows = cursor.fetchall()

        for r in rows:
            raw = float(r.get("raw_score", 0.0) or 0.0)
            score = _clamp01(raw)

            candidates.append({
                "id": str(r["id"]),
                "drug_name": r.get("drug_name") or "",
                "section": r.get("section") or "",
                "text": r.get("text") or "",
                "score": score,
                "source": {"set_id": r.get("set_id") or "", "spl_id": r.get("spl_id") or ""},
                # optional: keep raw distance/score for debugging
                # "debug": {"raw_score": raw}
            })

        msg = f"SemanticRetriever: Found {len(candidates)} candidates (top_k={top_k}, per_label_k={per_label_k})."
        if filter_set_ids:
            msg += f" Filtered to {len(filter_set_ids)} set_id(s)."
        state.trace_log.append(msg)

    except Exception as e:
        state.trace_log.append(f"SemanticRetriever: DB error: {str(e)}")

    # Record plan metadata (ensure plan exists already)
    plan["semantic_query"] = query
    plan["semantic_top_k"] = top_k
    plan["filter_set_ids"] = filter_set_ids
    plan["per_label_k"] = per_label_k
    plan["min_chunk_len"] = min_chunk_len

    state.retrieval["results"] = candidates
    state.flags["next_step"] = "reranker"