"""MCP-style local tool registry for LabelChat.

Each tool is defined with an MCP-compatible JSON schema and handler so it can
be invoked by the LabelChat agent loop (and, if desired later, exposed over
standard MCP). All tools respect feature-gate permissions and reuse existing
platform services (labelquery Oracle/PG compilers, resolve_spl_xml, DrugTox).
"""

from __future__ import annotations

import json
import logging
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional

from sqlalchemy import text

from dashboard.services.feature_gates import is_allowed
from dashboard.services.fdalabel_db import FDALabelDBService
from database.extensions import db

logger = logging.getLogger(__name__)

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.I,
)
_APPNUM_RE = re.compile(r"^(NDA|ANDA|BLA)\s*0*(\d{4,6})$", re.I)
_NDC_RE = re.compile(r"^\d{4,5}-\d{3,4}(-\d{1,2})?$")


@dataclass
class MCPTool:
    """Declarative definition of a local MCP-style tool."""

    name: str
    description: str
    input_schema: Dict[str, Any]
    handler: Callable[[Dict[str, Any], Any], Dict[str, Any]]
    required_feature: Optional[str] = None

    def to_openai_tool(self) -> Dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.input_schema,
            },
        }


# ---------------------------------------------------------------------------
# Helpers: WireQuery construction & Oracle / PG label search
# ---------------------------------------------------------------------------


def _classify_product_role(is_rld: bool, appr_num: str, market_cat: str) -> str:
    appr_u = (appr_num or "").upper()
    mkt_u = (market_cat or "").upper()
    if is_rld:
        return "RLD (Reference Listed Drug)"
    if appr_u.startswith(("NDA", "BLA")) or "NDA" in mkt_u or "BLA" in mkt_u:
        return "Reference / Brand (NDA/BLA)"
    if appr_u.startswith("ANDA") or "ANDA" in mkt_u:
        return "Generic (ANDA)"
    return "Other"


def _sort_results_rld_first(results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    def _rank(item: Dict[str, Any]) -> tuple:
        role = item.get("product_role", "")
        if item.get("is_rld"):
            tier = 0
        elif "NDA/BLA" in role:
            tier = 1
        elif "ANDA" in role:
            tier = 2
        else:
            tier = 3
        return (tier, -(int(re.sub(r"\D", "", item.get("revised_date") or "") or "0")))

    return sorted(results, key=_rank)


def _build_wire_query(args: Dict[str, Any]) -> Dict[str, Any]:
    """Builds a labelquery WireQuery dict from structured search_labels args."""
    criteria: List[Dict[str, Any]] = []

    drug_name = (args.get("drug_name") or "").strip()
    if drug_name:
        criteria.append({
            "type": "productName",
            "value": {"field": "any", "op": "contains", "text": drug_name},
        })

    set_id = (args.get("set_id") or "").strip()
    if set_id:
        criteria.append({
            "type": "identifier",
            "value": {"setSplGuid": set_id},
        })

    app_num = (args.get("application_number") or "").strip()
    if app_num:
        m = _APPNUM_RE.match(app_num)
        if m:
            criteria.append({
                "type": "identifier",
                "value": {"applKind": m.group(1).upper(), "applNum": m.group(2)},
            })
        else:
            criteria.append({
                "type": "identifier",
                "value": {"applNum": app_num},
            })

    ndc = (args.get("ndc") or "").strip()
    if ndc:
        criteria.append({
            "type": "identifier",
            "value": {"ndcCode": ndc},
        })

    if args.get("rld_only"):
        criteria.append({
            "type": "applicationType",
            "value": {"values": ["NDA", "BLA"]},
        })

    return {"groups": [{"criteria": criteria}], "exactMatch": False}


def _execute_oracle_search(wire_query: Dict[str, Any], limit: int) -> Optional[Dict[str, Any]]:
    """Executes a WireQuery against Oracle if a connection is available."""
    conn = FDALabelDBService.get_oracle_connection()
    if not conn:
        return None
    try:
        from labelquery.oracle_compiler import compile_oracle_query
        from labelquery.blueprint import _expand_meddra, _capabilities, _oracle_base_table

        sql, params, warnings = compile_oracle_query(
            wire_query,
            limit=limit,
            offset=0,
            expand_meddra=_expand_meddra,
            capabilities=_capabilities(),
            base_table=_oracle_base_table("oracle"),
        )
        cur = conn.cursor()
        cur.execute(sql, params)
        rows = cur.fetchall()
        cur.close()

        results: List[Dict[str, Any]] = []
        total = 0
        if rows:
            first_r = rows[0]
            if isinstance(first_r, dict):
                total = first_r.get("total_count") or first_r.get("TOTAL_COUNT") or len(rows)
            else:
                total = first_r[16] if len(first_r) > 16 else (first_r[15] if len(first_r) > 15 else len(rows))

            for r in rows:
                if isinstance(r, dict):
                    sid = r.get("set_id") or r.get("SET_ID")
                    if not sid:
                        continue
                    results.append({
                        "set_id": sid,
                        "spl_id": r.get("spl_id") or r.get("SPL_ID") or "",
                        "brand_name": r.get("product_names") or r.get("PRODUCT_NAMES") or "",
                        "generic_name": r.get("generic_names") or r.get("GENERIC_NAMES") or "",
                        "manufacturer": r.get("manufacturer") or r.get("MANUFACTURER") or "",
                        "application_number": r.get("appr_num") or r.get("APPR_NUM") or "",
                        "ndc_codes": r.get("ndc_codes") or r.get("NDC_CODES") or "",
                        "revised_date": str(r.get("revised_date") or r.get("REVISED_DATE") or ""),
                        "market_category": r.get("market_categories") or r.get("MARKET_CATEGORIES") or "",
                        "is_rld": bool(r.get("is_rld") or r.get("IS_RLD")),
                    })
                else:
                    if not r[0]:
                        continue
                    results.append({
                        "set_id": r[0],
                        "spl_id": r[1] or "",
                        "brand_name": r[2] or "",
                        "generic_name": r[3] or "",
                        "manufacturer": r[4] or "",
                        "application_number": r[5] or "",
                        "ndc_codes": r[6] or "",
                        "revised_date": str(r[8] or "") if len(r) > 8 else "",
                        "market_category": str(r[10] or "") if len(r) > 10 else "",
                        "is_rld": False,
                    })

        for item in results:
            ndc_str = item.get("ndc_codes") or ""
            if len(ndc_str) > 120:
                item["ndc_codes"] = ndc_str[:120] + "..."
            item["product_role"] = _classify_product_role(
                bool(item.get("is_rld")),
                item.get("application_number", ""),
                item.get("market_category", ""),
            )
        results = _sort_results_rld_first(results)
        return {
            "source_db": "oracle",
            "total_count": int(total),
            "results": results,
            "warnings": warnings,
        }
    except Exception as exc:
        logger.warning("Oracle search_labels failed, falling back to local PG: %s", exc)
        return None
    finally:
        try:
            conn.close()
        except Exception:
            pass


def _execute_local_search(args: Dict[str, Any], limit: int) -> Dict[str, Any]:
    """Executes a label search against the local PostgreSQL labeling schema."""
    query_str = (
        args.get("set_id")
        or args.get("application_number")
        or args.get("ndc")
        or args.get("drug_name")
        or ""
    ).strip()

    if not query_str:
        return {"source_db": "local", "total_count": 0, "results": []}

    rows, total_count = FDALabelDBService.search_labels_with_count(query_str, limit=limit)
    results = []
    for r in rows:
        results.append({
            "set_id": r.get("set_id", ""),
            "spl_id": r.get("spl_id", "") or "",
            "brand_name": r.get("brand_name", "") or "",
            "generic_name": r.get("generic_name", "") or "",
            "manufacturer": r.get("manufacturer_name", "") or "",
            "application_number": r.get("application_number", "") or "",
            "ndc_codes": r.get("ndc", "") or "",
            "revised_date": str(r.get("revised_date", "") or ""),
            "market_category": r.get("market_category", "") or "",
            "is_rld": bool(r.get("is_rld", False)),
        })
    for item in results:
        ndc_str = item.get("ndc_codes") or ""
        if len(ndc_str) > 120:
            item["ndc_codes"] = ndc_str[:120] + "..."
        item["product_role"] = _classify_product_role(
            bool(item.get("is_rld")),
            item.get("application_number", ""),
            item.get("market_category", ""),
        )
    results = _sort_results_rld_first(results)
    return {
        "source_db": "local",
        "total_count": int(total_count),
        "results": results,
    }


def handle_search_labels(args: Dict[str, Any], user: Any) -> Dict[str, Any]:
    """Searches FDA drug labels in Oracle (primary) or local PostgreSQL."""
    limit = max(1, min(int(args.get("limit") or 8), 15))
    target_db = (args.get("target_db") or "oracle").strip().lower()

    wire_query = _build_wire_query(args)
    if not wire_query["groups"][0]["criteria"]:
        return {"error": "Provide at least one search parameter (drug_name, set_id, application_number, or ndc)."}

    payload = None
    if target_db == "oracle":
        payload = _execute_oracle_search(wire_query, limit=limit)

    if payload is None:
        payload = _execute_local_search(args, limit=limit)
        effective_db = "local"
    else:
        effective_db = "oracle"

    payload["wire_query"] = wire_query
    payload["target_db"] = effective_db
    return payload


# ---------------------------------------------------------------------------
# SPL XML Section Extraction
# ---------------------------------------------------------------------------

def _strip_ns(tag: str) -> str:
    return tag.split("}", 1)[-1] if "}" in tag else tag


def _extract_plain_text(elem: ET.Element) -> str:
    parts: List[str] = []
    for text_seg in elem.itertext():
        cleaned = " ".join(text_seg.split())
        if cleaned:
            parts.append(cleaned)
    return " ".join(parts)


def _parse_spl_sections(xml_content: str) -> List[Dict[str, Any]]:
    """Parses HL7 SPL XML into a flat list of {code, title, text} sections."""
    root = ET.fromstring(xml_content)
    sections: List[Dict[str, Any]] = []

    for elem in root.iter():
        if _strip_ns(elem.tag) != "section":
            continue

        code = ""
        title = ""
        text_chunks: List[str] = []

        for child in elem:
            ctag = _strip_ns(child.tag)
            if ctag == "code" and not code:
                code = (child.attrib.get("code") or "").strip()
            elif ctag == "title" and not title:
                title = _extract_plain_text(child)
            elif ctag == "text":
                txt = _extract_plain_text(child)
                if txt:
                    text_chunks.append(txt)

        body = "\n".join(text_chunks).strip()
        if title or body:
            sections.append({
                "code": code,
                "title": title or (f"Section {code}" if code else "Untitled Section"),
                "text": body,
                "char_length": len(body),
            })

    return sections


def handle_read_label_sections(args: Dict[str, Any], user: Any) -> Dict[str, Any]:
    """Reads an SPL label's table of contents or specific sections by title/LOINC code."""
    set_id = (args.get("set_id") or "").strip()
    if not set_id:
        return {"error": "set_id is required."}

    spl_id = (args.get("spl_id") or "").strip() or None
    mode = (args.get("mode") or "sections").strip().lower()
    queries = [str(q).strip().lower() for q in (args.get("section_queries") or []) if str(q).strip()]

    xml_content, source = FDALabelDBService.resolve_spl_xml(set_id, spl_id=spl_id)
    if not xml_content:
        return {
            "has_full_text": False,
            "error": f"SPL XML not available locally or in Oracle for set_id={set_id}.",
            "set_id": set_id,
        }

    try:
        sections = _parse_spl_sections(xml_content)
    except ET.ParseError as exc:
        return {
            "error": f"Failed to parse SPL XML for {set_id}: {exc}",
            "set_id": set_id,
        }

    if mode == "toc" or not queries:
        toc = [
            {"code": s["code"], "title": s["title"], "char_length": s["char_length"]}
            for s in sections[:60]
        ]
        if mode == "toc":
            return {"set_id": set_id, "source": source, "sections_toc": toc}

    matched: List[Dict[str, Any]] = []
    if queries:
        for s in sections:
            title_l = s["title"].lower()
            code_l = s["code"].lower()
            if any(q in title_l or q == code_l for q in queries):
                matched.append(s)
    else:
        # Default overview: return top key clinical sections up to budget
        priority_keywords = (
            "boxed warning",
            "indications",
            "dosage",
            "contraindications",
            "warnings",
            "adverse reactions",
        )
        for s in sections:
            if any(k in s["title"].lower() for k in priority_keywords):
                matched.append(s)
        if not matched:
            matched = sections[:6]

    # Enforce character budget (24,000 chars total)
    budget = 16000
    used = 0
    out_sections = []
    for s in matched:
        if used >= budget:
            break
        remaining = budget - used
        txt = s["text"][:remaining]
        used += len(txt)
        out_sections.append({
            "code": s["code"],
            "title": s["title"],
            "text": txt,
            "truncated": len(s["text"]) > len(txt),
        })

    return {
        "set_id": set_id,
        "source": source,
        "has_full_text": True,
        "matched_count": len(out_sections),
        "sections": out_sections,
        "available_titles": [s["title"] for s in sections[:40]],
    }


# ---------------------------------------------------------------------------
# DrugTox Analysis Query
# ---------------------------------------------------------------------------

def handle_query_drugtox(args: Dict[str, Any], user: Any) -> Dict[str, Any]:
    """Queries harmonized DrugTox records in public.drug_toxicity."""
    q = (args.get("query") or "").strip()
    tox_type = (args.get("tox_type") or "DILI").strip()
    limit = max(1, min(int(args.get("limit") or 8), 15))

    if not q:
        return {"error": "query (drug name, generic name, or set_id) is required."}

    try:
        sql = text("""
            SELECT
                dt."SETID" AS set_id,
                COALESCE(dt."Trade_Name", s.product_names) AS trade_name,
                COALESCE(dt."Generic_Proper_Names", s.generic_names) AS generic_name,
                dt."Toxicity_Class" AS toxicity_class,
                dt."Tox_Type" AS tox_type,
                COALESCE(dt."Author_Organization", s.manufacturer) AS manufacturer,
                dt."SPL_Effective_Time" AS effective_time,
                dt."Update_Notes" AS update_notes,
                dt."Explanations" AS explanations,
                dt."AI_Summary" AS ai_summary,
                COALESCE(dt."is_historical", 0) AS is_historical
            FROM public.drug_toxicity dt
            LEFT JOIN labeling.sum_spl s ON s.set_id = dt."SETID" AND s.is_latest = TRUE
            WHERE (
                dt."SETID" = :q_exact
                OR dt."Trade_Name" ILIKE :q_like
                OR dt."Generic_Proper_Names" ILIKE :q_like
                OR s.product_names ILIKE :q_like
                OR s.generic_names ILIKE :q_like
            )
            AND (:tox_type = 'ALL' OR UPPER(COALESCE(dt."Tox_Type", 'DILI')) = UPPER(:tox_type))
            ORDER BY COALESCE(dt."is_historical", 0) ASC, dt."SPL_Effective_Time" DESC NULLS LAST
            LIMIT :limit
        """)
        rows = db.session.execute(
            sql,
            {"q_exact": q, "q_like": f"%{q}%", "tox_type": tox_type, "limit": limit},
        ).fetchall()

        records = []
        for r in rows:
            d = dict(r._mapping)
            for k in ("explanations", "ai_summary", "update_notes"):
                if isinstance(d.get(k), str) and len(d[k]) > 1500:
                    d[k] = d[k][:1500] + "..."
            records.append(d)

        return {
            "query": q,
            "tox_type": tox_type,
            "count": len(records),
            "records": records,
        }
    except Exception as exc:
        logger.error("query_drugtox failed: %s", exc)
        return {"error": f"DrugTox query failed: {exc}", "count": 0, "records": []}




# ---------------------------------------------------------------------------
# Label Version History
# ---------------------------------------------------------------------------

def handle_get_label_history(args: Dict[str, Any], user: Any) -> Dict[str, Any]:
    """Fetches historical SPL versions by set_id or application_number from local DB."""
    set_id = (args.get("set_id") or "").strip()
    appr_num = (args.get("application_number") or "").strip()
    limit = max(1, min(int(args.get("limit") or 15), 30))

    if not set_id and not appr_num:
        return {"error": "Provide set_id or application_number."}

    conn = FDALabelDBService.get_connection(force_local=True)
    if not conn:
        return {"error": "Local database is not connected."}

    try:
        cursor = conn.cursor()
        if set_id:
            sql = """
                SELECT
                    s.spl_id, s.set_id, s.product_names, s.generic_names,
                    s.revised_date, s.version_number, s.is_latest, s.parent_spl_id,
                    a.executive_summary, a.is_regulatory_notable
                FROM labeling.sum_spl s
                LEFT JOIN labeling.history_analysis a
                  ON s.spl_id = a.current_spl_id
                 AND a.raw_prompt_version = 'compact-spl-diff-v3'
                 AND a.previous_spl_id = s.parent_spl_id
                WHERE s.set_id = %s
                ORDER BY s.revised_date DESC NULLS LAST, s.version_number DESC NULLS LAST, s.spl_id
                LIMIT %s
            """
            cursor.execute(sql, (set_id, limit))
        else:
            cleaned = re.sub(r"\s+", "", appr_num).upper()
            sql = """
                SELECT
                    s.spl_id, s.set_id, s.product_names, s.generic_names,
                    s.revised_date, s.version_number, s.is_latest, s.parent_spl_id,
                    a.executive_summary, a.is_regulatory_notable
                FROM labeling.sum_spl s
                LEFT JOIN labeling.history_analysis a
                  ON s.spl_id = a.current_spl_id
                 AND a.raw_prompt_version = 'compact-spl-diff-v3'
                 AND a.previous_spl_id = s.parent_spl_id
                WHERE REPLACE(UPPER(COALESCE(s.appr_num, '')), ' ', '') ILIKE %s
                ORDER BY s.revised_date DESC NULLS LAST, s.version_number DESC NULLS LAST, s.spl_id
                LIMIT %s
            """
            cursor.execute(sql, (f"%{cleaned}%", limit))

        rows = cursor.fetchall()
        cursor.close()

        versions = []
        for r in rows:
            versions.append({
                "spl_id": r["spl_id"],
                "set_id": r["set_id"],
                "product_names": r["product_names"],
                "generic_names": r["generic_names"],
                "revised_date": str(r["revised_date"] or ""),
                "version_number": r["version_number"],
                "is_latest": bool(r["is_latest"]),
                "parent_spl_id": r["parent_spl_id"],
                "is_regulatory_notable": bool(r["is_regulatory_notable"]),
                "executive_summary": (r["executive_summary"] or "")[:800] if r["executive_summary"] else None,
            })

        return {
            "set_id": set_id or (versions[0]["set_id"] if versions else ""),
            "application_number": appr_num,
            "total_versions": len(versions),
            "versions": versions,
        }
    except Exception as exc:
        logger.error("get_label_history failed: %s", exc)
        return {"error": f"Failed to load label history: {exc}", "versions": []}
    finally:
        try:
            conn.close()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# FAERS Adverse Event Signals
# ---------------------------------------------------------------------------

def handle_query_faers_signals(args: Dict[str, Any], user: Any) -> Dict[str, Any]:
    """Queries top reported FAERS adverse event reactions for a drug via openFDA."""
    from dashboard.services.fda_client import get_faers_data

    drug_name = (args.get("drug_name") or "").strip()
    set_id = (args.get("set_id") or "").strip()
    limit = max(1, min(int(args.get("limit") or 15), 30))

    if not drug_name:
        return {"error": "drug_name is required."}

    data = get_faers_data(drug_name, limit=limit)
    if not data:
        return {"drug_name": drug_name, "set_id": set_id, "reactions": [], "error": "No FAERS records returned."}
    if isinstance(data, dict) and data.get("error"):
        return {"drug_name": drug_name, "set_id": set_id, "reactions": [], "error": str(data["error"])}

    reactions = data.get("reactions") or []
    return {
        "drug_name": drug_name,
        "set_id": set_id,
        "count": len(reactions),
        "reactions": reactions,
    }

# ---------------------------------------------------------------------------
# Action Button Builder (validated & permission-gated)
# ---------------------------------------------------------------------------

def validate_and_filter_actions(raw_actions: List[Dict[str, Any]], user: Any) -> List[Dict[str, Any]]:
    """Validates action button payloads and filters them against feature gates."""
    can_labelcomp = is_allowed(user, "tool_labelcomp")
    can_labelquery = is_allowed(user, "localquery") or True  # labelquery is open; localquery gated
    can_faers = is_allowed(user, "tool_faers")
    can_hist_sid = is_allowed(user, "tool_history_set_id")
    can_hist_app = is_allowed(user, "tool_history_application")
    agent_gates = {
        "dili": is_allowed(user, "tool_dili"),
        "dict": is_allowed(user, "tool_dict"),
        "diri": is_allowed(user, "tool_diri"),
        "pgx": is_allowed(user, "tool_pgx"),
    }

    validated: List[Dict[str, Any]] = []
    seen = set()

    for act in raw_actions:
        if not isinstance(act, dict):
            continue
        atype = (act.get("type") or "").strip()
        label = (act.get("label") or "").strip()

        if atype == "spl_view":
            sid = (act.get("set_id") or "").strip()
            if not sid:
                continue
            spl_id = (act.get("spl_id") or "").strip() or None
            key = ("spl_view", sid, spl_id)
            if key in seen:
                continue
            seen.add(key)
            validated.append({
                "type": "spl_view",
                "label": label or "Open SPL Label View",
                "set_id": sid,
                **({"spl_id": spl_id} if spl_id else {}),
            })

        elif atype == "labelcomp":
            if not can_labelcomp:
                continue
            sids = [str(s).strip() for s in (act.get("set_ids") or []) if str(s).strip()][:4]
            if len(sids) < 1:
                continue
            key = ("labelcomp", tuple(sids))
            if key in seen:
                continue
            seen.add(key)
            validated.append({
                "type": "labelcomp",
                "label": label or f"Compare in LabelComp ({len(sids)})",
                "set_ids": sids,
                **({"spl_ids": act["spl_ids"]} if act.get("spl_ids") else {}),
            })

        elif atype == "labelquery":
            if not can_labelquery:
                continue
            wq = act.get("wire_query")
            if not isinstance(wq, dict) or not wq.get("groups"):
                continue
            target_db = (act.get("target_db") or "oracle").strip().lower()
            key = ("labelquery", json.dumps(wq, sort_keys=True), target_db)
            if key in seen:
                continue
            seen.add(key)
            validated.append({
                "type": "labelquery",
                "label": label or "Open Search Results in LabelQuery",
                "wire_query": wq,
                "target_db": target_db,
            })

        elif atype == "drugtox":
            sid = (act.get("set_id") or "").strip()
            q = (act.get("query") or "").strip()
            agent = (act.get("agent") or "dili").strip().lower()
            if agent not in agent_gates:
                agent = "dili"
            if not agent_gates.get(agent, True):
                continue
            if not sid and not q:
                continue
            key = ("drugtox", sid or q, agent)
            if key in seen:
                continue
            seen.add(key)
            default_label = f"Open {agent.upper()} Agent" if sid else "Open askDrugTox"
            validated.append({
                "type": "drugtox",
                "label": label or default_label,
                "agent": agent,
                **({"set_id": sid} if sid else {}),
                **({"query": q} if q else {}),
            })

        elif atype == "label_history":
            sid = (act.get("set_id") or "").strip()
            appr = (act.get("application_number") or "").strip()
            if appr and can_hist_app:
                key = ("label_history_app", appr)
                if key not in seen:
                    seen.add(key)
                    validated.append({
                        "type": "label_history",
                        "label": label or f"View Application History ({appr})",
                        "application_number": appr,
                    })
            elif sid and can_hist_sid:
                key = ("label_history_sid", sid)
                if key not in seen:
                    seen.add(key)
                    validated.append({
                        "type": "label_history",
                        "label": label or "View Version History",
                        "set_id": sid,
                    })

        elif atype == "faers":
            if not can_faers:
                continue
            sid = (act.get("set_id") or "").strip()
            if not sid:
                continue
            key = ("faers", sid)
            if key in seen:
                continue
            seen.add(key)
            validated.append({
                "type": "faers",
                "label": label or "Open FAERS Analysis",
                "set_id": sid,
            })

    return validated


def handle_emit_action_buttons(args: Dict[str, Any], user: Any) -> Dict[str, Any]:
    """Validates and returns action buttons for the frontend to render."""
    raw = args.get("actions") or []
    validated = validate_and_filter_actions(raw, user)
    return {"actions": validated, "count": len(validated)}


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

class MCPToolRegistry:
    """Central registry of local MCP-style tools."""

    def __init__(self) -> None:
        self._tools: Dict[str, MCPTool] = {}

    def register(self, tool: MCPTool) -> None:
        self._tools[tool.name] = tool

    def available_tools(self, user: Any) -> List[MCPTool]:
        out: List[MCPTool] = []
        for t in self._tools.values():
            if t.required_feature and not is_allowed(user, t.required_feature):
                continue
            out.append(t)
        return out

    def openai_tools(self, user: Any) -> List[Dict[str, Any]]:
        return [t.to_openai_tool() for t in self.available_tools(user)]

    def call(self, name: str, args: Dict[str, Any], user: Any) -> Dict[str, Any]:
        tool = self._tools.get(name)
        if not tool:
            return {"error": f"Unknown tool: {name}"}
        if tool.required_feature and not is_allowed(user, tool.required_feature):
            return {"error": f"Permission denied for tool: {name}"}
        try:
            return tool.handler(args or {}, user)
        except Exception as exc:
            logger.exception("MCP tool %s failed", name)
            return {"error": f"Tool {name} raised an error: {exc}"}


def build_default_registry() -> MCPToolRegistry:
    reg = MCPToolRegistry()

    reg.register(MCPTool(
        name="search_labels",
        description=(
            "Search FDA drug labeling records in Oracle (or local PostgreSQL fallback) by "
            "drug name, set_id, application number (NDA/ANDA/BLA), or NDC. Returns matching "
            "metadata rows and a wire_query object for opening full results in /labelquery."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "drug_name": {"type": "string", "description": "Brand, generic, or active ingredient name."},
                "set_id": {"type": "string", "description": "SPL Set ID UUID."},
                "application_number": {"type": "string", "description": "FDA application number, e.g. NDA021500."},
                "ndc": {"type": "string", "description": "NDC code."},
                "rld_only": {"type": "boolean", "description": "Filter toward NDA/BLA reference products."},
                "target_db": {"type": "string", "enum": ["oracle", "local"], "default": "oracle"},
                "limit": {"type": "integer", "default": 10, "minimum": 1, "maximum": 20},
            },
        },
        handler=handle_search_labels,
    ))

    reg.register(MCPTool(
        name="read_label_sections",
        description=(
            "Read the Table of Contents or extracted plain-text clinical sections from a specific "
            "SPL label XML (via local storage or Oracle) given its set_id."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "set_id": {"type": "string", "description": "SPL Set ID UUID."},
                "spl_id": {"type": "string", "description": "Optional SPL version ID."},
                "mode": {"type": "string", "enum": ["toc", "sections"], "default": "sections"},
                "section_queries": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Section titles or LOINC codes to extract, e.g. ['Boxed Warning', 'Indications', 'Adverse Reactions'].",
                },
            },
            "required": ["set_id"],
        },
        handler=handle_read_label_sections,
    ))

    reg.register(MCPTool(
        name="query_drugtox",
        description=(
            "ONLY call when the user explicitly asks about drug toxicity, DILI (liver injury), "
            "DICT (cardiotoxicity), DIRI (renal injury), or PGx (pharmacogenomics). "
            "Queries harmonized DrugTox toxicity records by drug name or SETID."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Drug name, generic name, or SETID."},
                "tox_type": {"type": "string", "default": "DILI", "description": "Toxicity type such as DILI or ALL."},
                "limit": {"type": "integer", "default": 10, "minimum": 1, "maximum": 20},
            },
            "required": ["query"],
        },
        handler=handle_query_drugtox,
    ))

    reg.register(MCPTool(
        name="get_label_history",
        description=(
            "Retrieve historical SPL labeling versions (revision dates, version numbers, "
            "and prior AI change summaries if available) by set_id or application_number."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "set_id": {"type": "string", "description": "SPL Set ID UUID."},
                "application_number": {"type": "string", "description": "FDA application number, e.g. NDA209637."},
                "limit": {"type": "integer", "default": 15, "minimum": 1, "maximum": 30},
            },
        },
        handler=handle_get_label_history,
    ))

    reg.register(MCPTool(
        name="query_faers_signals",
        description=(
            "Query top reported FAERS adverse event reactions (MedDRA Preferred Terms and report counts) "
            "for a drug generic/brand name. Pass set_id if known so the user can open the FAERS dashboard."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "drug_name": {"type": "string", "description": "Generic or brand drug name."},
                "set_id": {"type": "string", "description": "Optional SPL Set ID for deep-linking to FAERS view."},
                "limit": {"type": "integer", "default": 15, "minimum": 1, "maximum": 30},
            },
            "required": ["drug_name"],
        },
        required_feature="tool_faers",
        handler=handle_query_faers_signals,
    ))

    return reg


DEFAULT_REGISTRY = build_default_registry()
