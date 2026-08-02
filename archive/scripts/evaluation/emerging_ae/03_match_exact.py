#!/usr/bin/env python3

import os
import re
import json
import html
import zipfile
import xml.etree.ElementTree as ET
from typing import Dict, List, Optional, Tuple, Any

import pandas as pd
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

load_dotenv()

# ==============================
# CONFIG
# ==============================

PG_CONN_STR = os.getenv(
    "DATABASE_URL",
    "postgresql://afd_user:afd_password@localhost:5432/askfdalabel"
)

INPUT_LABEL_MAP = "scripts/evaluation/emerging_ae/01_prior_labels_before_2023.csv"
INPUT_FAERS = "scripts/evaluation/emerging_ae/02_faers_emerging_terms_long.csv"

OUTPUT_LONG = "scripts/evaluation/emerging_ae/03_label_exact_match_long.csv"
OUTPUT_FOR_AI = "scripts/evaluation/emerging_ae/03_label_exact_match_for_ai.csv"
OUTPUT_PAIR_SUMMARY = "scripts/evaluation/emerging_ae/03_label_pair_section_summary.csv"

CHECKPOINT_EVERY = 200

TARGET_SECTION_GROUPS = {
    "contraindications": {
        "codes": {"34070-3"},
        "title_variants": ["contraindications"],
        "display_name": "Contraindications",
    },
    "warnings_and_precautions": {
        "codes": {"43685-7", "34071-1", "42232-9", "34072-9"},
        "title_variants": [
            "warnings and precautions",
            "warning and precautions",
            "warnings",
            "precautions",
            "general precautions",
        ],
        "display_name": "Warnings and Precautions",
    },
    "adverse_reactions": {
        "codes": {"34084-4", "90374-0", "90375-7"},
        "title_variants": [
            "adverse reactions",
            "clinical trials experience",
            "postmarketing experience",
        ],
        "display_name": "Adverse Reactions",
    },
    "drug_interactions": {
        "codes": {"34073-7", "34074-5"},
        "title_variants": [
            "drug interactions",
            "drug and laboratory test interactions",
        ],
        "display_name": "Drug Interactions",
    },
}

PLR_REQUIRED_GROUP = "warnings_and_precautions"
NS = {"hl7": "urn:hl7-org:v3"}


# ==============================
# DB
# ==============================

def get_connection():
    return psycopg2.connect(PG_CONN_STR)


def fetch_local_paths(cur, spl_ids: List[str]) -> Dict[str, str]:
    if not spl_ids:
        return {}

    query = """
        SELECT spl_id, local_path
        FROM labeling.sum_spl
        WHERE spl_id = ANY(%s)
    """
    cur.execute(query, (spl_ids,))
    rows = cur.fetchall()
    return {row["spl_id"]: row["local_path"] for row in rows if row.get("local_path")}


# ==============================
# TEXT HELPERS
# ==============================

def normalize_space(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def normalize_text(text: Optional[str]) -> str:
    if not text:
        return ""
    text = html.unescape(str(text))
    text = text.lower()
    text = re.sub(r"[\u00ae\u2122]", "", text)
    text = re.sub(r"[^a-z0-9\s\-/\.]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def normalize_term(term: Optional[str]) -> str:
    return normalize_text(term)


def make_snippet(raw_text: str, term: str, window: int = 120) -> Optional[str]:
    if not raw_text or not term:
        return None

    pattern = re.compile(re.escape(term), re.IGNORECASE)
    match = pattern.search(raw_text)
    if match:
        start = max(0, match.start() - window)
        end = min(len(raw_text), match.end() + window)
        return raw_text[start:end]

    norm_raw = normalize_text(raw_text)
    norm_term = normalize_term(term)
    idx = norm_raw.find(norm_term)
    if idx >= 0:
        start = max(0, idx - window)
        end = min(len(norm_raw), idx + len(norm_term) + window)
        return norm_raw[start:end]

    return None


# ==============================
# ZIP / XML HELPERS
# ==============================

def resolve_local_zip_path(local_path: Optional[str]) -> Optional[str]:
    if not local_path:
        return None

    path = os.path.expanduser(str(local_path).strip())

    if os.path.exists(path):
        return path

    abs_path = os.path.abspath(path)
    if os.path.exists(abs_path):
        return abs_path

    spl_base = os.getenv("SPL_STORAGE_DIR", "data/spl_storage")
    candidate = os.path.join(spl_base, path)
    if os.path.exists(candidate):
        return candidate

    candidate2 = os.path.join(spl_base, os.path.basename(path))
    if os.path.exists(candidate2):
        return candidate2

    return None


def find_xml_member_in_zip(zf: zipfile.ZipFile) -> Optional[str]:
    names = zf.namelist()
    xml_names = [n for n in names if n.lower().endswith(".xml")]
    if not xml_names:
        return None
    xml_names.sort(key=lambda x: ("/" in x, len(x)), reverse=True)
    return xml_names[0]


def load_xml_root_from_dailymed_zip(zip_path: str) -> ET.Element:
    with zipfile.ZipFile(zip_path, "r") as zf:
        xml_member = find_xml_member_in_zip(zf)
        if not xml_member:
            raise ValueError(f"No XML file found in ZIP: {zip_path}")
        xml_bytes = zf.read(xml_member)

    try:
        return ET.fromstring(xml_bytes)
    except Exception:
        text = xml_bytes.decode("utf-8", errors="ignore")
        return ET.fromstring(text.encode("utf-8", errors="ignore"))


# ==============================
# SPL SECTION EXTRACTION
# ==============================

def get_effective_code(node: ET.Element) -> Optional[str]:
    candidates = []

    code_el = node.find("./hl7:code", NS)
    if code_el is not None and code_el.get("code"):
        candidates.append(code_el.get("code"))

    code_els = node.findall(".//hl7:code", NS)
    for el in code_els[:5]:
        if el.get("code"):
            candidates.append(el.get("code"))

    for c in candidates:
        if c:
            return c.strip()

    return None


def extract_node_title(node: ET.Element) -> str:
    title_el = node.find("./hl7:title", NS)
    if title_el is not None:
        text = " ".join(title_el.itertext()).strip()
        if text:
            return normalize_space(text)

    text = " ".join(node.itertext()).strip()
    return normalize_space(text[:200]) if text else ""


def extract_node_text(node: ET.Element) -> str:
    return normalize_space(" ".join(node.itertext()))


def node_matches_group(node: ET.Element, group_name: str) -> bool:
    cfg = TARGET_SECTION_GROUPS[group_name]
    code = get_effective_code(node)
    if code and code in cfg["codes"]:
        return True

    title = normalize_text(extract_node_title(node))
    for variant in cfg["title_variants"]:
        if variant in title:
            return True

    return False


def collect_section_nodes(root: ET.Element, group_name: str) -> List[Dict[str, Any]]:
    out = []
    nodes = root.findall(".//hl7:section", NS)

    for idx, node in enumerate(nodes):
        if node_matches_group(node, group_name):
            out.append(
                {
                    "section_id": idx,
                    "loinc_code": get_effective_code(node),
                    "title": extract_node_title(node),
                    "section_text": extract_node_text(node),
                }
            )

    deduped = []
    seen = set()
    for item in out:
        key = (
            item.get("loinc_code"),
            item.get("title"),
            item.get("section_text", "")[:500],
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)

    return deduped


def build_target_section_map_from_xml(root: ET.Element) -> Dict[str, List[Dict[str, Any]]]:
    grouped = {}
    for group_name in TARGET_SECTION_GROUPS.keys():
        grouped[group_name] = collect_section_nodes(root, group_name)
    return grouped


def has_required_plr_sections(section_map: Dict[str, List[Dict[str, Any]]]) -> bool:
    return len(section_map.get(PLR_REQUIRED_GROUP, [])) > 0


def flatten_section_map_text(section_map: Dict[str, List[Dict[str, Any]]]) -> str:
    parts = []
    for group_name, cfg in TARGET_SECTION_GROUPS.items():
        secs = section_map.get(group_name, [])
        if not secs:
            continue

        parts.append(f"=== {cfg['display_name'].upper()} ===")
        for sec in secs:
            loinc = sec.get("loinc_code") or ""
            title = sec.get("title") or ""
            text = sec.get("section_text") or ""
            parts.append(f"[{loinc}] {title}\n{text}".strip())

    return "\n\n".join(parts)


# ==============================
# MATCHING
# ==============================

def literal_match_sections(sections: List[Dict[str, Any]], term: str) -> List[Dict[str, Any]]:
    norm_term = normalize_term(term)
    if not norm_term:
        return []

    matches = []
    for sec in sections:
        raw_text = sec.get("section_text") or ""
        norm_text = normalize_text(raw_text)

        if norm_term in norm_text:
            matches.append(
                {
                    "section_id": sec.get("section_id"),
                    "loinc_code": sec.get("loinc_code"),
                    "title": sec.get("title"),
                    "snippet": make_snippet(raw_text, term),
                    "method": "literal_normalized",
                }
            )

    return matches


def dedupe_matches(matches: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = set()
    out = []
    for m in matches:
        key = (m.get("section_id"), m.get("method"), m.get("loinc_code"))
        if key in seen:
            continue
        seen.add(key)
        out.append(m)
    return out


def summarize_matches(matches: List[Dict[str, Any]]) -> Tuple[bool, str, str, str]:
    if not matches:
        return False, "", "[]", "[]"

    methods = sorted(set(m.get("method", "") for m in matches if m.get("method")))
    titles = []
    snippets = []

    for m in matches[:10]:
        label = f"[{m.get('loinc_code')}] {m.get('title') or ''}".strip()
        if label:
            titles.append(label)
        if m.get("snippet"):
            snippets.append(m["snippet"])

    return (
        True,
        ",".join(methods),
        json.dumps(titles[:10], ensure_ascii=False),
        json.dumps(snippets[:10], ensure_ascii=False),
    )


def match_term_against_section_map(section_map: Dict[str, List[Dict[str, Any]]], term: str) -> Dict[str, Any]:
    target_sections = []
    for group_name in TARGET_SECTION_GROUPS.keys():
        target_sections.extend(section_map.get(group_name, []))

    literal_matches = literal_match_sections(target_sections, term)
    all_matches = dedupe_matches(literal_matches)
    found, method, section_titles_json, snippets_json = summarize_matches(all_matches)

    matched_groups = []
    matched_loinc_codes = []
    if found:
        for group_name in TARGET_SECTION_GROUPS.keys():
            group_ids = {sec.get("section_id") for sec in section_map.get(group_name, [])}
            for m in all_matches:
                if m.get("section_id") in group_ids:
                    matched_groups.append(group_name)
                    break
        matched_loinc_codes = sorted(set(m.get("loinc_code") for m in all_matches if m.get("loinc_code")))

    return {
        "found": found,
        "method": method,
        "section_titles_json": section_titles_json,
        "snippets_json": snippets_json,
        "matched_groups_json": json.dumps(sorted(set(matched_groups)), ensure_ascii=False),
        "matched_loinc_codes_json": json.dumps(matched_loinc_codes, ensure_ascii=False),
    }


# ==============================
# INPUT
# ==============================

def safe_bool(value) -> bool:
    if pd.isna(value):
        return False
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"true", "1", "yes", "y"}


def load_inputs() -> Tuple[pd.DataFrame, pd.DataFrame]:
    if not os.path.exists(INPUT_LABEL_MAP):
        raise FileNotFoundError(f"Missing file: {INPUT_LABEL_MAP}")
    if not os.path.exists(INPUT_FAERS):
        raise FileNotFoundError(f"Missing file: {INPUT_FAERS}")

    labels_df = pd.read_csv(INPUT_LABEL_MAP)
    faers_df = pd.read_csv(INPUT_FAERS)

    required_label_cols = [
        "input_set_id",
        "latest_spl_id",
        "latest_set_id",
        "latest_generic_names",
        "latest_revised_date",
        "latest_is_plr",
        "prior_spl_id",
        "prior_set_id",
        "prior_generic_names",
        "prior_revised_date",
        "prior_is_plr",
        "both_are_plr",
        "has_prior_before_2023",
    ]
    missing_label = [c for c in required_label_cols if c not in labels_df.columns]
    if missing_label:
        raise ValueError(f"Missing columns in {INPUT_LABEL_MAP}: {missing_label}")

    required_faers_cols = [
        "input_set_id",
        "latest_spl_id",
        "latest_set_id",
        "latest_generic_names",
        "latest_revised_date",
        "latest_is_plr",
        "prior_spl_id",
        "prior_set_id",
        "prior_generic_names",
        "prior_revised_date",
        "prior_is_plr",
        "both_are_plr",
        "faers_query_generic",
        "first_faers_report_date",
        "has_prebaseline_history",
        "baseline_start",
        "baseline_end",
        "recent_start",
        "recent_end",
        "meddra_pt",
        "baseline_count",
        "recent_count",
    ]
    missing_faers = [c for c in required_faers_cols if c not in faers_df.columns]
    if missing_faers:
        raise ValueError(f"Missing columns in {INPUT_FAERS}: {missing_faers}")

    return labels_df, faers_df


# ==============================
# MAIN
# ==============================

def main():
    labels_df, faers_df = load_inputs()

    labels_df = labels_df[labels_df["has_prior_before_2023"].apply(safe_bool)].copy()
    if labels_df.empty:
        raise ValueError("No matched prior labels found in 01 file.")
    if faers_df.empty:
        raise ValueError("No emerging AE rows found in 02 file.")

    faers_df = faers_df.drop_duplicates(
        subset=["input_set_id", "prior_spl_id", "latest_spl_id", "meddra_pt"]
    ).copy()

    label_cols = [
        "input_set_id",
        "latest_spl_id",
        "latest_set_id",
        "latest_generic_names",
        "latest_revised_date",
        "latest_is_plr",
        "prior_spl_id",
        "prior_set_id",
        "prior_generic_names",
        "prior_revised_date",
        "prior_is_plr",
        "both_are_plr",
    ]

    merged = faers_df.merge(
        labels_df[label_cols].drop_duplicates(subset=["input_set_id", "latest_spl_id", "prior_spl_id"]),
        on=["input_set_id", "latest_spl_id", "prior_spl_id"],
        how="left",
        suffixes=("", "_from01"),
    )

    for col in [
        "latest_set_id",
        "latest_generic_names",
        "latest_revised_date",
        "latest_is_plr",
        "prior_set_id",
        "prior_generic_names",
        "prior_revised_date",
        "prior_is_plr",
        "both_are_plr",
    ]:
        from01_col = f"{col}_from01"
        if from01_col in merged.columns:
            merged[col] = merged[col].fillna(merged[from01_col])

    drop_cols = [c for c in merged.columns if c.endswith("_from01")]
    if drop_cols:
        merged = merged.drop(columns=drop_cols)

    conn = get_connection()

    local_path_cache: Dict[str, str] = {}
    section_map_cache: Dict[str, Dict[str, List[Dict[str, Any]]]] = {}

    pair_summary_rows = []
    kept_rows = []

    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            needed_spl_ids = sorted(
                set(merged["prior_spl_id"].dropna().astype(str).tolist())
                | set(merged["latest_spl_id"].dropna().astype(str).tolist())
            )
            local_path_cache = fetch_local_paths(cur, needed_spl_ids)

            total = len(merged)

            for idx, row in enumerate(merged.itertuples(index=False), start=1):
                input_set_id = getattr(row, "input_set_id")
                meddra_pt = getattr(row, "meddra_pt")
                prior_spl_id = getattr(row, "prior_spl_id", None)
                latest_spl_id = getattr(row, "latest_spl_id", None)

                if not prior_spl_id or not latest_spl_id:
                    continue

                if prior_spl_id not in section_map_cache:
                    prior_zip = resolve_local_zip_path(local_path_cache.get(prior_spl_id))
                    if not prior_zip:
                        raise FileNotFoundError(f"Missing or invalid local_path for prior spl_id={prior_spl_id}")
                    prior_root = load_xml_root_from_dailymed_zip(prior_zip)
                    section_map_cache[prior_spl_id] = build_target_section_map_from_xml(prior_root)

                if latest_spl_id not in section_map_cache:
                    latest_zip = resolve_local_zip_path(local_path_cache.get(latest_spl_id))
                    if not latest_zip:
                        raise FileNotFoundError(f"Missing or invalid local_path for latest spl_id={latest_spl_id}")
                    latest_root = load_xml_root_from_dailymed_zip(latest_zip)
                    section_map_cache[latest_spl_id] = build_target_section_map_from_xml(latest_root)

                prior_section_map = section_map_cache[prior_spl_id]
                latest_section_map = section_map_cache[latest_spl_id]

                prior_is_plr_xml = has_required_plr_sections(prior_section_map)
                latest_is_plr_xml = has_required_plr_sections(latest_section_map)
                keep_pair = prior_is_plr_xml and latest_is_plr_xml

                pair_summary_rows.append(
                    {
                        "input_set_id": input_set_id,
                        "prior_spl_id": prior_spl_id,
                        "latest_spl_id": latest_spl_id,
                        "prior_is_plr_from_01": getattr(row, "prior_is_plr", None),
                        "latest_is_plr_from_01": getattr(row, "latest_is_plr", None),
                        "both_are_plr_from_01": getattr(row, "both_are_plr", None),
                        "prior_is_plr_from_xml": prior_is_plr_xml,
                        "latest_is_plr_from_xml": latest_is_plr_xml,
                        "keep_pair_both_plr": keep_pair,
                        "prior_contraindications_sections": len(prior_section_map["contraindications"]),
                        "prior_warnings_sections": len(prior_section_map["warnings_and_precautions"]),
                        "prior_adverse_reactions_sections": len(prior_section_map["adverse_reactions"]),
                        "prior_drug_interactions_sections": len(prior_section_map["drug_interactions"]),
                        "latest_contraindications_sections": len(latest_section_map["contraindications"]),
                        "latest_warnings_sections": len(latest_section_map["warnings_and_precautions"]),
                        "latest_adverse_reactions_sections": len(latest_section_map["adverse_reactions"]),
                        "latest_drug_interactions_sections": len(latest_section_map["drug_interactions"]),
                    }
                )

                if not keep_pair:
                    continue

                prior_result = match_term_against_section_map(prior_section_map, meddra_pt)
                latest_result = match_term_against_section_map(latest_section_map, meddra_pt)

                matched_in_prior_exact = prior_result["found"]
                matched_in_latest_exact = latest_result["found"]

                if matched_in_prior_exact and matched_in_latest_exact:
                    exact_status = "matched_both_exact"
                elif matched_in_prior_exact and not matched_in_latest_exact:
                    exact_status = "matched_prior_only_exact"
                elif not matched_in_prior_exact and matched_in_latest_exact:
                    exact_status = "matched_latest_only_exact"
                else:
                    exact_status = "matched_neither_exact"

                kept_rows.append(
                    {
                        "input_set_id": input_set_id,

                        "latest_spl_id": latest_spl_id,
                        "latest_set_id": getattr(row, "latest_set_id", None),
                        "latest_generic_names": getattr(row, "latest_generic_names", None),
                        "latest_revised_date": getattr(row, "latest_revised_date", None),
                        "latest_is_plr": getattr(row, "latest_is_plr", None),
                        "latest_local_path": local_path_cache.get(latest_spl_id),

                        "prior_spl_id": prior_spl_id,
                        "prior_set_id": getattr(row, "prior_set_id", None),
                        "prior_generic_names": getattr(row, "prior_generic_names", None),
                        "prior_revised_date": getattr(row, "prior_revised_date", None),
                        "prior_is_plr": getattr(row, "prior_is_plr", None),
                        "prior_local_path": local_path_cache.get(prior_spl_id),

                        "both_are_plr": getattr(row, "both_are_plr", None),

                        "faers_query_generic": getattr(row, "faers_query_generic", None),
                        "first_faers_report_date": getattr(row, "first_faers_report_date", None),
                        "has_prebaseline_history": getattr(row, "has_prebaseline_history", None),

                        "baseline_start": getattr(row, "baseline_start", None),
                        "baseline_end": getattr(row, "baseline_end", None),
                        "recent_start": getattr(row, "recent_start", None),
                        "recent_end": getattr(row, "recent_end", None),

                        "meddra_pt": meddra_pt,
                        "baseline_count": getattr(row, "baseline_count", None),
                        "recent_count": getattr(row, "recent_count", None),

                        "searched_section_groups": json.dumps(list(TARGET_SECTION_GROUPS.keys())),
                        "searched_loinc_codes": json.dumps({
                            k: sorted(list(v["codes"])) for k, v in TARGET_SECTION_GROUPS.items()
                        }),

                        "matched_in_prior_exact": matched_in_prior_exact,
                        "prior_match_method": prior_result["method"],
                        "prior_match_groups": prior_result["matched_groups_json"],
                        "prior_match_loinc_codes": prior_result["matched_loinc_codes_json"],
                        "prior_match_sections": prior_result["section_titles_json"],
                        "prior_match_snippets": prior_result["snippets_json"],

                        "matched_in_latest_exact": matched_in_latest_exact,
                        "latest_match_method": latest_result["method"],
                        "latest_match_groups": latest_result["matched_groups_json"],
                        "latest_match_loinc_codes": latest_result["matched_loinc_codes_json"],
                        "latest_match_sections": latest_result["section_titles_json"],
                        "latest_match_snippets": latest_result["snippets_json"],

                        "needs_ai_rematch": (not matched_in_prior_exact) and (not matched_in_latest_exact),
                        "exact_status": exact_status,
                    }
                )

                if idx % CHECKPOINT_EVERY == 0 or idx == total:
                    pd.DataFrame(kept_rows).to_csv(OUTPUT_LONG, index=False)
                    pd.DataFrame(pair_summary_rows).drop_duplicates(
                        subset=["input_set_id", "prior_spl_id", "latest_spl_id"]
                    ).to_csv(OUTPUT_PAIR_SUMMARY, index=False)
                    print(f"Processed {idx}/{total} | kept_rows={len(kept_rows)}")

    finally:
        conn.close()

    long_df = pd.DataFrame(kept_rows)
    pair_df = pd.DataFrame(pair_summary_rows).drop_duplicates(
        subset=["input_set_id", "prior_spl_id", "latest_spl_id"]
    )

    # Build consolidated AI queue: one row per label pair
    ai_source_df = long_df[long_df["needs_ai_rematch"].apply(safe_bool)].copy()

    ai_group_rows = []
    if not ai_source_df.empty:
        grouped = ai_source_df.groupby(
            ["input_set_id", "prior_spl_id", "latest_spl_id"],
            dropna=False,
        )

        for (input_set_id, prior_spl_id, latest_spl_id), g in grouped:
            prior_set_id = g["prior_set_id"].dropna().iloc[0] if not g["prior_set_id"].dropna().empty else None
            latest_set_id = g["latest_set_id"].dropna().iloc[0] if not g["latest_set_id"].dropna().empty else None
            prior_drug_name = g["prior_generic_names"].dropna().iloc[0] if not g["prior_generic_names"].dropna().empty else None
            latest_drug_name = g["latest_generic_names"].dropna().iloc[0] if not g["latest_generic_names"].dropna().empty else None
            prior_local_path = g["prior_local_path"].dropna().iloc[0] if not g["prior_local_path"].dropna().empty else None
            latest_local_path = g["latest_local_path"].dropna().iloc[0] if not g["latest_local_path"].dropna().empty else None
            faers_query_generic = g["faers_query_generic"].dropna().iloc[0] if not g["faers_query_generic"].dropna().empty else None
            first_faers_report_date = g["first_faers_report_date"].dropna().iloc[0] if not g["first_faers_report_date"].dropna().empty else None
            has_prebaseline_history = g["has_prebaseline_history"].dropna().iloc[0] if not g["has_prebaseline_history"].dropna().empty else None
            baseline_start = g["baseline_start"].dropna().iloc[0] if not g["baseline_start"].dropna().empty else None
            baseline_end = g["baseline_end"].dropna().iloc[0] if not g["baseline_end"].dropna().empty else None
            recent_start = g["recent_start"].dropna().iloc[0] if not g["recent_start"].dropna().empty else None
            recent_end = g["recent_end"].dropna().iloc[0] if not g["recent_end"].dropna().empty else None
            searched_section_groups = g["searched_section_groups"].dropna().iloc[0] if not g["searched_section_groups"].dropna().empty else None
            searched_loinc_codes = g["searched_loinc_codes"].dropna().iloc[0] if not g["searched_loinc_codes"].dropna().empty else None

            # Rebuild section text once from local paths already captured
            # Since long_df no longer stores section blobs, recover from caches by rerunning the same extraction logic from file paths would be overkill here.
            # So create from first matched row context using local paths already processed in main via the existing caches:
            prior_section_text = None
            latest_section_text = None

            # Reconstruct from currently available cached maps
            # These names exist in local scope if script reached this point successfully.
            # We guard them anyway.
            if prior_spl_id in section_map_cache:
                prior_section_text = flatten_section_map_text(section_map_cache[prior_spl_id])
            if latest_spl_id in section_map_cache:
                latest_section_text = flatten_section_map_text(section_map_cache[latest_spl_id])

            terms_df = (
                g[["meddra_pt", "recent_count", "baseline_count"]]
                .sort_values(["meddra_pt", "recent_count"], ascending=[True, False])
                .drop_duplicates(subset=["meddra_pt"])
            )

            terms_list = []
            for _, r in terms_df.iterrows():
                terms_list.append(
                    {
                        "term": r["meddra_pt"],
                        "recent_count": None if pd.isna(r["recent_count"]) else int(r["recent_count"]),
                        "baseline_count": None if pd.isna(r["baseline_count"]) else int(r["baseline_count"]),
                    }
                )

            missing_ae_terms_text = "; ".join([str(x["term"]) for x in terms_list])

            ai_group_rows.append(
                {
                    "input_set_id": input_set_id,

                    "prior_spl_id": prior_spl_id,
                    "prior_set_id": prior_set_id,
                    "prior_drug_name": prior_drug_name,
                    "prior_local_path": prior_local_path,

                    "latest_spl_id": latest_spl_id,
                    "latest_set_id": latest_set_id,
                    "latest_drug_name": latest_drug_name,
                    "latest_local_path": latest_local_path,

                    "faers_query_generic": faers_query_generic,
                    "first_faers_report_date": first_faers_report_date,
                    "has_prebaseline_history": has_prebaseline_history,

                    "baseline_start": baseline_start,
                    "baseline_end": baseline_end,
                    "recent_start": recent_start,
                    "recent_end": recent_end,

                    "target_section_groups": searched_section_groups,
                    "target_loinc_codes": searched_loinc_codes,

                    "missing_ae_count": len(terms_list),
                    "missing_ae_terms_json": json.dumps(terms_list, ensure_ascii=False),
                    "missing_ae_terms_text": missing_ae_terms_text,

                    "prior_section_text": prior_section_text,
                    "latest_section_text": latest_section_text,
                }
            )

    ai_df = pd.DataFrame(ai_group_rows)

    os.makedirs(os.path.dirname(OUTPUT_LONG), exist_ok=True)
    long_df.to_csv(OUTPUT_LONG, index=False)
    ai_df.to_csv(OUTPUT_FOR_AI, index=False)
    pair_df.to_csv(OUTPUT_PAIR_SUMMARY, index=False)

    print("\nDone.")
    print(f"Saved: {OUTPUT_LONG}")
    print(f"Saved: {OUTPUT_FOR_AI}")
    print(f"Saved: {OUTPUT_PAIR_SUMMARY}")

    if not pair_df.empty:
        print("\nPair filtering summary:")
        print(pair_df["keep_pair_both_plr"].value_counts(dropna=False).to_string())

    if not long_df.empty:
        print("\nExact status counts:")
        print(long_df["exact_status"].value_counts(dropna=False).to_string())

    if not ai_df.empty:
        print("\nAI queue preview:")
        preview_cols = [
            "input_set_id",
            "prior_spl_id",
            "latest_spl_id",
            "missing_ae_count",
            "missing_ae_terms_text",
        ]
        print(ai_df[preview_cols].head(10).to_string(index=False))


if __name__ == "__main__":
    main()