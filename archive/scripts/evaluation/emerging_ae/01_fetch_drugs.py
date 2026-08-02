#!/usr/bin/env python3

import os
import re
import sys
from typing import List, Optional, Tuple, Dict, Any

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

SEED_OUTPUT_FILE = "scripts/evaluation/emerging_ae/01_latest_plr_2026_seed.csv"
OUTPUT_FILE = "scripts/evaluation/emerging_ae/01_prior_labels_before_2023.csv"

LATEST_START_DATE = "2026-01-01"
CUTOFF_DATE = "2023-01-01"
LOWER_BOUND_DATE = "2019-01-01"

# If True, only accept prior labels in [2019-01-01, 2023-01-01)
# If False, accept any prior label before 2023-01-01
REQUIRE_2019_TO_2022 = True

# Require prior label to also be PLR
REQUIRE_PRIOR_PLR = True

# Prefer only RLD latest labels if available in metadata
FILTER_LATEST_TO_RLD_ONLY = False


# ==============================
# DB CONNECTION
# ==============================

def get_connection():
    return psycopg2.connect(PG_CONN_STR)


# ==============================
# NORMALIZATION HELPERS
# ==============================

def normalize_text(value: Optional[str]) -> str:
    if not value:
        return ""
    value = value.lower().strip()
    value = re.sub(r"[\u00ae\u2122]", "", value)
    value = re.sub(r"[^a-z0-9/,+ -]+", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def split_multi_value_field(value: Optional[str]) -> List[str]:
    if not value:
        return []
    text = normalize_text(value)
    parts = re.split(r"[;\|\n]+", text)
    cleaned = []
    for part in parts:
        part = part.strip(" ,")
        if part:
            cleaned.append(part)
    return cleaned


def choose_primary_token(value: Optional[str]) -> str:
    parts = split_multi_value_field(value)
    return parts[0] if parts else ""


def normalize_route(value: Optional[str]) -> str:
    return choose_primary_token(value)


def normalize_dosage_form(value: Optional[str]) -> str:
    return choose_primary_token(value)


def normalize_generic(value: Optional[str]) -> str:
    text = choose_primary_token(value)
    text = re.sub(r"\s+", " ", text).strip()
    return text


# ==============================
# PLR HELPERS
# ==============================

def is_plr_spl(cur, spl_id: Optional[str]) -> bool:
    if not spl_id:
        return False

    query = """
        SELECT 1
        FROM labeling.spl_sections
        WHERE spl_id = %s
          AND (
                lower(title) LIKE '%%warnings and precautions%%'
             OR lower(title) LIKE '%%warning and precautions%%'
             OR lower(title) LIKE '%%warnings & precautions%%'
             OR lower(title) LIKE '%%warning & precautions%%'
          )
        LIMIT 1
    """
    cur.execute(query, (spl_id,))
    return cur.fetchone() is not None


# ==============================
# QUERY HELPERS
# ==============================

def get_date_clause(alias: str = "s") -> str:
    if REQUIRE_2019_TO_2022:
        return f"""
            {alias}.revised_date >= %(lower_bound_date)s
            AND {alias}.revised_date < %(cutoff_date)s
        """
    return f"""
        {alias}.revised_date < %(cutoff_date)s
    """


def fetch_latest_plr_seed_rows(cur) -> List[Dict[str, Any]]:
    rld_clause = "AND s.is_rld = TRUE" if FILTER_LATEST_TO_RLD_ONLY else ""

    query = f"""
        SELECT DISTINCT
            s.spl_id,
            s.set_id,
            s.product_names,
            s.generic_names,
            s.manufacturer,
            s.appr_num,
            s.active_ingredients,
            s.routes,
            s.dosage_forms,
            s.market_categories,
            s.doc_type,
            s.revised_date,
            s.is_rld,
            s.is_rs
        FROM labeling.sum_spl s
        WHERE s.revised_date >= %(latest_start_date)s
          {rld_clause}
          AND EXISTS (
                SELECT 1
                FROM labeling.spl_sections sec
                WHERE sec.spl_id = s.spl_id
                  AND (
                        lower(sec.title) LIKE '%%warnings and precautions%%'
                     OR lower(sec.title) LIKE '%%warning and precautions%%'
                     OR lower(sec.title) LIKE '%%warnings & precautions%%'
                     OR lower(sec.title) LIKE '%%warning & precautions%%'
                  )
          )
        ORDER BY s.revised_date DESC NULLS LAST, s.spl_id DESC
    """
    cur.execute(query, {"latest_start_date": LATEST_START_DATE})
    return cur.fetchall()


def fetch_prior_same_set_id(
    cur,
    set_id: str,
    require_plr: bool = False,
) -> Optional[Dict[str, Any]]:
    plr_clause = """
      AND EXISTS (
            SELECT 1
            FROM labeling.spl_sections sec
            WHERE sec.spl_id = s.spl_id
              AND (
                    lower(sec.title) LIKE '%%warnings and precautions%%'
                 OR lower(sec.title) LIKE '%%warning and precautions%%'
                 OR lower(sec.title) LIKE '%%warnings & precautions%%'
                 OR lower(sec.title) LIKE '%%warning & precautions%%'
              )
      )
    """ if require_plr else ""

    query = f"""
        SELECT
            s.spl_id,
            s.set_id,
            s.product_names,
            s.generic_names,
            s.manufacturer,
            s.appr_num,
            s.active_ingredients,
            s.routes,
            s.dosage_forms,
            s.market_categories,
            s.doc_type,
            s.revised_date,
            s.is_rld,
            s.is_rs
        FROM labeling.sum_spl s
        WHERE s.set_id = %(set_id)s
          AND {get_date_clause("s")}
          {plr_clause}
        ORDER BY s.revised_date DESC NULLS LAST, s.spl_id DESC
        LIMIT 1
    """
    cur.execute(
        query,
        {
            "set_id": set_id,
            "cutoff_date": CUTOFF_DATE,
            "lower_bound_date": LOWER_BOUND_DATE,
        },
    )
    return cur.fetchone()


def fetch_prior_same_appr_num(
    cur,
    appr_num: Optional[str],
    exclude_set_id: Optional[str] = None,
    require_plr: bool = False,
) -> Optional[Dict[str, Any]]:
    if not appr_num:
        return None

    plr_clause = """
      AND EXISTS (
            SELECT 1
            FROM labeling.spl_sections sec
            WHERE sec.spl_id = s.spl_id
              AND (
                    lower(sec.title) LIKE '%%warnings and precautions%%'
                 OR lower(sec.title) LIKE '%%warning and precautions%%'
                 OR lower(sec.title) LIKE '%%warnings & precautions%%'
                 OR lower(sec.title) LIKE '%%warning & precautions%%'
              )
      )
    """ if require_plr else ""

    query = f"""
        SELECT
            s.spl_id,
            s.set_id,
            s.product_names,
            s.generic_names,
            s.manufacturer,
            s.appr_num,
            s.active_ingredients,
            s.routes,
            s.dosage_forms,
            s.market_categories,
            s.doc_type,
            s.revised_date,
            s.is_rld,
            s.is_rs
        FROM labeling.sum_spl s
        WHERE s.appr_num = %(appr_num)s
          AND {get_date_clause("s")}
          AND (%(exclude_set_id)s IS NULL OR s.set_id <> %(exclude_set_id)s)
          {plr_clause}
        ORDER BY s.revised_date DESC NULLS LAST, s.spl_id DESC
        LIMIT 1
    """
    cur.execute(
        query,
        {
            "appr_num": appr_num,
            "exclude_set_id": exclude_set_id,
            "cutoff_date": CUTOFF_DATE,
            "lower_bound_date": LOWER_BOUND_DATE,
        },
    )
    return cur.fetchone()


def fetch_candidates_by_generic(
    cur,
    generic_name: str,
    require_plr: bool = False,
) -> List[Dict[str, Any]]:
    if not generic_name:
        return []

    plr_clause = """
      AND EXISTS (
            SELECT 1
            FROM labeling.spl_sections sec
            WHERE sec.spl_id = s.spl_id
              AND (
                    lower(sec.title) LIKE '%%warnings and precautions%%'
                 OR lower(sec.title) LIKE '%%warning and precautions%%'
                 OR lower(sec.title) LIKE '%%warnings & precautions%%'
                 OR lower(sec.title) LIKE '%%warning & precautions%%'
              )
      )
    """ if require_plr else ""

    query = f"""
        SELECT
            s.spl_id,
            s.set_id,
            s.product_names,
            s.generic_names,
            s.manufacturer,
            s.appr_num,
            s.active_ingredients,
            s.routes,
            s.dosage_forms,
            s.market_categories,
            s.doc_type,
            s.revised_date,
            s.is_rld,
            s.is_rs
        FROM labeling.sum_spl s
        WHERE s.generic_names IS NOT NULL
          AND lower(s.generic_names) LIKE %(generic_like)s
          AND {get_date_clause("s")}
          {plr_clause}
        ORDER BY s.revised_date DESC NULLS LAST, s.spl_id DESC
    """
    cur.execute(
        query,
        {
            "generic_like": f"%{generic_name.lower()}%",
            "cutoff_date": CUTOFF_DATE,
            "lower_bound_date": LOWER_BOUND_DATE,
        },
    )
    return cur.fetchall()


def score_generic_candidate(
    latest: Dict[str, Any],
    candidate: Dict[str, Any],
) -> Tuple[int, List[str], str]:
    score = 0
    reasons = []

    latest_generic = normalize_generic(latest.get("generic_names"))
    cand_generic = normalize_generic(candidate.get("generic_names"))

    latest_route = normalize_route(latest.get("routes"))
    cand_route = normalize_route(candidate.get("routes"))

    latest_form = normalize_dosage_form(latest.get("dosage_forms"))
    cand_form = normalize_dosage_form(candidate.get("dosage_forms"))

    latest_appr = normalize_text(latest.get("appr_num"))
    cand_appr = normalize_text(candidate.get("appr_num"))

    if latest_generic and cand_generic:
        if latest_generic == cand_generic:
            score += 50
            reasons.append("generic_exact")
        elif latest_generic in cand_generic or cand_generic in latest_generic:
            score += 30
            reasons.append("generic_partial")

    if latest_appr and cand_appr and latest_appr == cand_appr:
        score += 40
        reasons.append("appr_num_match")

    if latest_route and cand_route and latest_route == cand_route:
        score += 20
        reasons.append("route_match")

    if latest_form and cand_form and latest_form == cand_form:
        score += 20
        reasons.append("dosage_form_match")

    if candidate.get("is_rld") is True:
        score += 5
        reasons.append("candidate_is_rld")

    if score >= 90:
        confidence = "high"
    elif score >= 60:
        confidence = "medium"
    elif score >= 40:
        confidence = "low"
    else:
        confidence = "very_low"

    return score, reasons, confidence


def fetch_prior_by_generic_route_form(
    cur,
    latest: Dict[str, Any],
    require_plr: bool = False,
) -> Optional[Tuple[Dict[str, Any], int, List[str], str]]:
    generic_name = normalize_generic(latest.get("generic_names"))
    if not generic_name:
        return None

    candidates = fetch_candidates_by_generic(cur, generic_name, require_plr=require_plr)
    if not candidates:
        return None

    scored = []
    for cand in candidates:
        if cand["spl_id"] == latest["spl_id"]:
            continue

        score, reasons, confidence = score_generic_candidate(latest, cand)
        scored.append((cand, score, reasons, confidence))

    if not scored:
        return None

    scored.sort(
        key=lambda x: (
            x[1],
            x[0]["revised_date"] if x[0]["revised_date"] is not None else "",
            x[0]["spl_id"],
        ),
        reverse=True,
    )

    best = scored[0]
    if best[1] < 40:
        return None

    return best


# ==============================
# MAIN MATCH LOGIC
# ==============================

def build_result_row(
    latest: Optional[Dict[str, Any]],
    prior: Optional[Dict[str, Any]],
    match_tier: Optional[str],
    match_reason: Optional[str],
    match_confidence: Optional[str],
    match_score: Optional[int] = None,
    error: Optional[str] = None,
    latest_is_plr: Optional[bool] = None,
    prior_is_plr: Optional[bool] = None,
) -> Dict[str, Any]:
    row = {
        "input_set_id": latest["set_id"] if latest else None,

        "latest_spl_id": latest["spl_id"] if latest else None,
        "latest_set_id": latest["set_id"] if latest else None,
        "latest_product_names": latest["product_names"] if latest else None,
        "latest_generic_names": latest["generic_names"] if latest else None,
        "latest_manufacturer": latest["manufacturer"] if latest else None,
        "latest_appr_num": latest["appr_num"] if latest else None,
        "latest_active_ingredients": latest["active_ingredients"] if latest else None,
        "latest_routes": latest["routes"] if latest else None,
        "latest_dosage_forms": latest["dosage_forms"] if latest else None,
        "latest_market_categories": latest["market_categories"] if latest else None,
        "latest_doc_type": latest["doc_type"] if latest else None,
        "latest_revised_date": latest["revised_date"] if latest else None,
        "latest_is_rld": latest["is_rld"] if latest else None,
        "latest_is_rs": latest["is_rs"] if latest else None,

        "prior_spl_id": prior["spl_id"] if prior else None,
        "prior_set_id": prior["set_id"] if prior else None,
        "prior_product_names": prior["product_names"] if prior else None,
        "prior_generic_names": prior["generic_names"] if prior else None,
        "prior_manufacturer": prior["manufacturer"] if prior else None,
        "prior_appr_num": prior["appr_num"] if prior else None,
        "prior_active_ingredients": prior["active_ingredients"] if prior else None,
        "prior_routes": prior["routes"] if prior else None,
        "prior_dosage_forms": prior["dosage_forms"] if prior else None,
        "prior_market_categories": prior["market_categories"] if prior else None,
        "prior_doc_type": prior["doc_type"] if prior else None,
        "prior_revised_date": prior["revised_date"] if prior else None,
        "prior_is_rld": prior["is_rld"] if prior else None,
        "prior_is_rs": prior["is_rs"] if prior else None,

        "latest_is_plr": latest_is_plr,
        "prior_is_plr": prior_is_plr,
        "both_are_plr": bool(latest_is_plr and prior_is_plr),

        "has_prior_before_2023": prior is not None,
        "match_tier": match_tier,
        "match_reason": match_reason,
        "match_confidence": match_confidence,
        "match_score": match_score,
        "error": error,
    }
    return row


def find_best_prior_record(cur, latest: Dict[str, Any]) -> Tuple[
    Optional[Dict[str, Any]],
    Optional[str],
    Optional[str],
    Optional[str],
    Optional[int],
]:
    require_plr = REQUIRE_PRIOR_PLR

    prior = fetch_prior_same_set_id(cur, latest["set_id"], require_plr=require_plr)
    if prior and prior["spl_id"] != latest["spl_id"]:
        return prior, "tier_1_same_set_id", "same_set_id", "high", 100

    prior = fetch_prior_same_appr_num(
        cur,
        latest.get("appr_num"),
        exclude_set_id=latest["set_id"],
        require_plr=require_plr,
    )
    if prior:
        return prior, "tier_2_same_appr_num", "same_appr_num", "high", 90

    generic_match = fetch_prior_by_generic_route_form(cur, latest, require_plr=require_plr)
    if generic_match:
        prior, score, reasons, confidence = generic_match
        return prior, "tier_3_generic_route_form", ",".join(reasons), confidence, score

    return None, None, None, None, None


# ==============================
# MAIN
# ==============================

def main():
    conn = get_connection()
    seed_rows = []
    results = []

    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            seed_rows = fetch_latest_plr_seed_rows(cur)

            if not seed_rows:
                raise ValueError(
                    f"No latest PLR labels found with revised_date >= {LATEST_START_DATE}"
                )

            print(f"Latest PLR seed rows: {len(seed_rows)}")
            print(f"Latest start date: {LATEST_START_DATE}")
            print(f"Prior cutoff date: {CUTOFF_DATE}")
            print(f"Require prior labels in 2019-2022 window: {REQUIRE_2019_TO_2022}")
            print(f"Require prior label to be PLR: {REQUIRE_PRIOR_PLR}")
            print(f"Filter latest to RLD only: {FILTER_LATEST_TO_RLD_ONLY}")

            for idx, latest in enumerate(seed_rows, start=1):
                try:
                    latest_is_plr = is_plr_spl(cur, latest["spl_id"])
                    prior, match_tier, match_reason, match_confidence, match_score = find_best_prior_record(cur, latest)
                    prior_is_plr = is_plr_spl(cur, prior["spl_id"]) if prior else False

                    if REQUIRE_PRIOR_PLR and prior and not prior_is_plr:
                        prior = None
                        match_tier = None
                        match_reason = None
                        match_confidence = None
                        match_score = None

                    results.append(
                        build_result_row(
                            latest=latest,
                            prior=prior,
                            match_tier=match_tier,
                            match_reason=match_reason,
                            match_confidence=match_confidence,
                            match_score=match_score,
                            error=None,
                            latest_is_plr=latest_is_plr,
                            prior_is_plr=prior_is_plr,
                        )
                    )

                    if idx % 50 == 0 or idx == len(seed_rows):
                        matched = sum(1 for r in results if r["has_prior_before_2023"])
                        both_plr = sum(1 for r in results if r["both_are_plr"])
                        print(
                            f"Processed {idx}/{len(seed_rows)} | "
                            f"matched={matched} | both_plr={both_plr}"
                        )

                except Exception as e:
                    results.append(
                        build_result_row(
                            latest=latest,
                            prior=None,
                            match_tier=None,
                            match_reason=None,
                            match_confidence=None,
                            error=str(e),
                            latest_is_plr=True,
                            prior_is_plr=None,
                        )
                    )
                    print(f"Error processing latest spl_id={latest.get('spl_id')}: {e}", file=sys.stderr)

    finally:
        conn.close()

    seed_df = pd.DataFrame(seed_rows)
    df = pd.DataFrame(results)

    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    seed_df.to_csv(SEED_OUTPUT_FILE, index=False)
    df.to_csv(OUTPUT_FILE, index=False)

    print(f"\nSaved seed cohort to: {SEED_OUTPUT_FILE}")
    print(f"Saved matched pairs to: {OUTPUT_FILE}")

    print("\nMatch tier counts:")
    print(df["match_tier"].fillna("no_match").value_counts(dropna=False).to_string())

    print("\nPLR pair counts:")
    print(df["both_are_plr"].fillna(False).value_counts(dropna=False).to_string())

    print("\nPreview:")
    preview_cols = [
        "input_set_id",
        "latest_spl_id",
        "latest_generic_names",
        "latest_appr_num",
        "latest_revised_date",
        "latest_is_plr",
        "prior_spl_id",
        "prior_set_id",
        "prior_revised_date",
        "prior_is_plr",
        "both_are_plr",
        "match_tier",
        "match_reason",
        "match_confidence",
        "match_score",
        "error",
    ]
    print(df[preview_cols].head(10).to_string(index=False))


if __name__ == "__main__":
    main()