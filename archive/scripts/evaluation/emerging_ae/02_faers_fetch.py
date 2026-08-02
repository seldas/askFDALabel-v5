#!/usr/bin/env python3

"""
02_faers_fetch.py

Standalone FAERS emerging-AE extraction script using the OpenFDA API.

Input:
  scripts/evaluation/emerging_ae/01_prior_labels_before_2023.csv

Logic:
  - Keep only rows with matched prior labels
  - Keep only PLR pairs (latest + prior both PLR), if configured
  - Use patient.drug.openfda.generic_name as the drug query field
  - For each matched prior label, define:
      baseline window = 10 to 5 years before prior_revised_date
      recent window   = 5 years before prior_revised_date up to day before prior_revised_date
  - Query OpenFDA FAERS reaction PT counts in each window
  - Query the first FAERS receivedate for the drug
  - Only analyze emergence if the drug has FAERS history before baseline_start
  - Keep ONLY emerging PTs in the long output

Outputs:
  scripts/evaluation/emerging_ae/02_faers_drug_summary.csv
  scripts/evaluation/emerging_ae/02_faers_emerging_terms_long.csv
"""

import hashlib
import json
import os
import re
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

import pandas as pd
import requests
from dotenv import load_dotenv

load_dotenv()

# ==============================
# CONFIG
# ==============================

INPUT_FILE = "scripts/evaluation/emerging_ae/01_prior_labels_before_2023.csv"
OUTPUT_SUMMARY_FILE = "scripts/evaluation/emerging_ae/02_faers_drug_summary.csv"
OUTPUT_LONG_FILE = "scripts/evaluation/emerging_ae/02_faers_emerging_terms_long.csv"
CACHE_DIR = "scripts/evaluation/emerging_ae/cache/openfda_faers"

OPENFDA_BASE_URL = os.getenv("OPENFDA_BASE_URL", "https://api.fda.gov/drug/event.json")
OPENFDA_API_KEY = os.getenv("OPENFDA_API_KEY", "").strip()

REQUEST_TIMEOUT = 60
MAX_RETRIES = 5
RETRY_SLEEP_SECONDS = 2
CHECKPOINT_EVERY = 10

MIN_RECENT_COUNT = 100
STRICT_BASELINE_ZERO = True
REQUIRE_BOTH_PLR = True

USER_AGENT = "askFDALabel-emerging-ae/1.0"


# ==============================
# DATE HELPERS
# ==============================

def parse_date(value: str) -> datetime:
    if value is None or str(value).strip() == "":
        raise ValueError("Empty date")
    text = str(value).strip()

    for fmt in ("%Y-%m-%d", "%Y%m%d", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(text[:19], fmt)
        except ValueError:
            continue

    raise ValueError(f"Unable to parse date: {value}")


def format_yyyymmdd(dt: datetime) -> str:
    return dt.strftime("%Y%m%d")


def minus_years_safe(dt: datetime, years: int) -> datetime:
    try:
        return dt.replace(year=dt.year - years)
    except ValueError:
        return dt.replace(month=2, day=28, year=dt.year - years)


def build_windows(prior_revised_date: datetime) -> Dict[str, datetime]:
    recent_end = prior_revised_date - timedelta(days=1)
    recent_start = minus_years_safe(prior_revised_date, 5)
    baseline_end = recent_start - timedelta(days=1)
    baseline_start = minus_years_safe(prior_revised_date, 10)

    return {
        "baseline_start": baseline_start,
        "baseline_end": baseline_end,
        "recent_start": recent_start,
        "recent_end": recent_end,
    }


# ==============================
# TEXT NORMALIZATION
# ==============================

def normalize_text(value: Optional[str]) -> str:
    if value is None:
        return ""
    text = str(value).strip().lower()
    text = re.sub(r"[\u00ae\u2122]", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def split_multi_value_field(value: Optional[str]) -> List[str]:
    if value is None:
        return []

    text = str(value).strip()
    if not text:
        return []

    parts = re.split(r"[;\|\n]+", text)
    out = []
    for part in parts:
        cleaned = normalize_text(part.strip(" ,"))
        if cleaned:
            out.append(cleaned)
    return out


def choose_primary_generic(value: Optional[str]) -> str:
    parts = split_multi_value_field(value)
    if parts:
        return parts[0]

    text = normalize_text(value)
    if not text:
        return ""

    parts = [normalize_text(p) for p in text.split(",") if normalize_text(p)]
    return parts[0] if parts else text


# ==============================
# OPENFDA QUERY HELPERS
# ==============================

def build_search_string(generic_name: str, start_date: str, end_date: str) -> str:
    safe_generic = generic_name.replace('"', '\\"')
    return (
        f'patient.drug.openfda.generic_name:"{safe_generic}" '
        f'AND receivedate:[{start_date} TO {end_date}]'
    )


def build_generic_only_search(generic_name: str) -> str:
    safe_generic = generic_name.replace('"', '\\"')
    return f'patient.drug.openfda.generic_name:"{safe_generic}"'


def build_cache_key(prefix: str, payload: str) -> str:
    raw = f"{prefix}|{payload}"
    return hashlib.md5(raw.encode("utf-8")).hexdigest()


def get_cache_path(cache_key: str) -> str:
    os.makedirs(CACHE_DIR, exist_ok=True)
    return os.path.join(CACHE_DIR, f"{cache_key}.json")


def load_cache(cache_key: str) -> Optional[dict]:
    path = get_cache_path(cache_key)
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return None


def save_cache(cache_key: str, payload: dict) -> None:
    path = get_cache_path(cache_key)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def request_openfda(params: dict) -> dict:
    if OPENFDA_API_KEY:
        params["api_key"] = OPENFDA_API_KEY

    headers = {"User-Agent": USER_AGENT}

    last_error = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = requests.get(
                OPENFDA_BASE_URL,
                params=params,
                headers=headers,
                timeout=REQUEST_TIMEOUT,
            )

            if response.status_code == 200:
                return response.json()

            if response.status_code in (429, 500, 502, 503, 504):
                last_error = RuntimeError(
                    f"HTTP {response.status_code}: {response.text[:500]} | params={params}"
                )
                time.sleep(RETRY_SLEEP_SECONDS * attempt)
                continue

            raise RuntimeError(
                f"HTTP {response.status_code}: {response.text[:1000]} | params={params}"
            )

        except requests.RequestException as e:
            last_error = e
            time.sleep(RETRY_SLEEP_SECONDS * attempt)

    raise RuntimeError(f"OpenFDA request failed after retries: {last_error}")


def fetch_reaction_counts_for_window(
    generic_name: str,
    start_dt: datetime,
    end_dt: datetime,
) -> Tuple[Dict[str, int], int, str]:
    start_date = format_yyyymmdd(start_dt)
    end_date = format_yyyymmdd(end_dt)

    cache_key = build_cache_key(
        "counts",
        f"{generic_name}|{start_date}|{end_date}|patient.reaction.reactionmeddrapt.exact"
    )

    cached = load_cache(cache_key)
    if cached is None:
        search = build_search_string(generic_name, start_date, end_date)
        payload = request_openfda({
            "search": search,
            "count": "patient.reaction.reactionmeddrapt.exact",
            "limit": 1000,
        })
        save_cache(cache_key, payload)
        cache_status = "fetched"
    else:
        payload = cached
        cache_status = "cache"

    results = payload.get("results", [])
    pt_counts = {}
    total_reports_proxy = 0

    for row in results:
        term = row.get("term")
        count = row.get("count", 0)
        if term:
            pt_counts[str(term)] = int(count)
            total_reports_proxy += int(count)

    return pt_counts, total_reports_proxy, cache_status


def fetch_first_report_date(generic_name: str) -> Tuple[Optional[str], str]:
    """
    Return earliest FAERS receivedate for this generic, if available.
    """
    cache_key = build_cache_key("first_date", generic_name)
    cached = load_cache(cache_key)

    if cached is None:
        search = build_generic_only_search(generic_name)
        payload = request_openfda({
            "search": search,
            "limit": 1,
            "sort": "receivedate:asc",
        })
        save_cache(cache_key, payload)
        cache_status = "fetched"
    else:
        payload = cached
        cache_status = "cache"

    results = payload.get("results", [])
    if not results:
        return None, cache_status

    first_date = results[0].get("receivedate")
    return first_date, cache_status


# ==============================
# CORE ANALYSIS
# ==============================

def classify_emerging(baseline_count: int, recent_count: int) -> bool:
    if recent_count < MIN_RECENT_COUNT:
        return False

    if STRICT_BASELINE_ZERO:
        return baseline_count == 0

    return baseline_count <= 1


def safe_bool(value) -> bool:
    if pd.isna(value):
        return False
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    return text in {"true", "1", "yes", "y"}


def load_input_rows(path: str) -> pd.DataFrame:
    if not os.path.exists(path):
        raise FileNotFoundError(f"Input file not found: {path}")

    df = pd.read_csv(path)
    if df.empty:
        raise ValueError(f"Input file is empty: {path}")

    required = [
        "input_set_id",
        "latest_spl_id",
        "latest_set_id",
        "latest_generic_names",
        "latest_revised_date",
        "prior_spl_id",
        "prior_set_id",
        "prior_generic_names",
        "prior_revised_date",
        "has_prior_before_2023",
        "latest_is_plr",
        "prior_is_plr",
        "both_are_plr",
    ]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns: {missing}")

    return df


def filter_input_rows(df: pd.DataFrame) -> pd.DataFrame:
    matched_df = df[df["has_prior_before_2023"].apply(safe_bool)].copy()

    if REQUIRE_BOTH_PLR:
        matched_df = matched_df[
            matched_df["latest_is_plr"].apply(safe_bool)
            & matched_df["prior_is_plr"].apply(safe_bool)
            & matched_df["both_are_plr"].apply(safe_bool)
        ].copy()

    matched_df = matched_df.drop_duplicates(
        subset=["input_set_id", "latest_spl_id", "prior_spl_id"]
    ).copy()

    return matched_df


def analyze_one_drug(row: pd.Series) -> Tuple[Dict, List[Dict]]:
    input_set_id = row["input_set_id"]

    latest_spl_id = row.get("latest_spl_id")
    latest_set_id = row.get("latest_set_id")
    latest_generic_names = row.get("latest_generic_names")
    latest_revised_date = row.get("latest_revised_date")
    latest_is_plr = row.get("latest_is_plr")

    prior_spl_id = row.get("prior_spl_id")
    prior_set_id = row.get("prior_set_id")
    prior_generic_names = row.get("prior_generic_names")
    prior_revised_date_raw = row.get("prior_revised_date")
    prior_is_plr = row.get("prior_is_plr")

    query_generic = choose_primary_generic(prior_generic_names)
    if not query_generic:
        raise ValueError("Could not derive primary generic query term from prior_generic_names")

    prior_revised_date = parse_date(str(prior_revised_date_raw))
    windows = build_windows(prior_revised_date)

    first_report_date_raw, first_report_cache = fetch_first_report_date(query_generic)

    first_report_date = None
    has_prebaseline_history = False
    if first_report_date_raw:
        first_report_date = parse_date(str(first_report_date_raw))
        has_prebaseline_history = first_report_date <= windows["baseline_start"]

    baseline_counts = {}
    baseline_total_proxy = 0
    baseline_cache = None

    recent_counts = {}
    recent_total_proxy = 0
    recent_cache = None

    long_rows = []
    emerging_count = 0
    analyzable_for_emergence = bool(has_prebaseline_history)

    if analyzable_for_emergence:
        baseline_counts, baseline_total_proxy, baseline_cache = fetch_reaction_counts_for_window(
            query_generic,
            windows["baseline_start"],
            windows["baseline_end"],
        )
        recent_counts, recent_total_proxy, recent_cache = fetch_reaction_counts_for_window(
            query_generic,
            windows["recent_start"],
            windows["recent_end"],
        )

        all_pts = sorted(set(baseline_counts.keys()) | set(recent_counts.keys()))

        for pt in all_pts:
            baseline_count = baseline_counts.get(pt, 0)
            recent_count = recent_counts.get(pt, 0)
            is_emerging = classify_emerging(baseline_count, recent_count)

            if not is_emerging:
                continue

            emerging_count += 1

            baseline_prop = (baseline_count / baseline_total_proxy) if baseline_total_proxy > 0 else 0.0
            recent_prop = (recent_count / recent_total_proxy) if recent_total_proxy > 0 else 0.0
            fold_change = None if baseline_count == 0 else (recent_count / baseline_count)

            long_rows.append(
                {
                    "input_set_id": input_set_id,

                    "latest_spl_id": latest_spl_id,
                    "latest_set_id": latest_set_id,
                    "latest_generic_names": latest_generic_names,
                    "latest_revised_date": latest_revised_date,
                    "latest_is_plr": latest_is_plr,

                    "prior_spl_id": prior_spl_id,
                    "prior_set_id": prior_set_id,
                    "prior_generic_names": prior_generic_names,
                    "prior_revised_date": prior_revised_date.strftime("%Y-%m-%d"),
                    "prior_is_plr": prior_is_plr,

                    "both_are_plr": bool(safe_bool(latest_is_plr) and safe_bool(prior_is_plr)),

                    "faers_query_generic": query_generic,
                    "first_faers_report_date": first_report_date.strftime("%Y-%m-%d") if first_report_date else None,
                    "has_prebaseline_history": has_prebaseline_history,

                    "baseline_start": windows["baseline_start"].strftime("%Y-%m-%d"),
                    "baseline_end": windows["baseline_end"].strftime("%Y-%m-%d"),
                    "recent_start": windows["recent_start"].strftime("%Y-%m-%d"),
                    "recent_end": windows["recent_end"].strftime("%Y-%m-%d"),

                    "meddra_pt": pt,
                    "baseline_count": baseline_count,
                    "recent_count": recent_count,
                    "baseline_prop": baseline_prop,
                    "recent_prop": recent_prop,
                    "fold_change": fold_change,
                    "is_emerging": True,
                }
            )

    summary = {
        "input_set_id": input_set_id,

        "latest_spl_id": latest_spl_id,
        "latest_set_id": latest_set_id,
        "latest_generic_names": latest_generic_names,
        "latest_revised_date": latest_revised_date,
        "latest_is_plr": latest_is_plr,

        "prior_spl_id": prior_spl_id,
        "prior_set_id": prior_set_id,
        "prior_generic_names": prior_generic_names,
        "prior_revised_date": prior_revised_date.strftime("%Y-%m-%d"),
        "prior_is_plr": prior_is_plr,

        "both_are_plr": bool(safe_bool(latest_is_plr) and safe_bool(prior_is_plr)),

        "faers_query_generic": query_generic,
        "first_faers_report_date": first_report_date.strftime("%Y-%m-%d") if first_report_date else None,
        "first_faers_report_cache_status": first_report_cache,
        "has_prebaseline_history": has_prebaseline_history,
        "analyzable_for_emergence": analyzable_for_emergence,

        "baseline_start": windows["baseline_start"].strftime("%Y-%m-%d"),
        "baseline_end": windows["baseline_end"].strftime("%Y-%m-%d"),
        "recent_start": windows["recent_start"].strftime("%Y-%m-%d"),
        "recent_end": windows["recent_end"].strftime("%Y-%m-%d"),

        "baseline_total_reports_proxy": baseline_total_proxy if analyzable_for_emergence else None,
        "recent_total_reports_proxy": recent_total_proxy if analyzable_for_emergence else None,
        "baseline_unique_pts": len(baseline_counts) if analyzable_for_emergence else None,
        "recent_unique_pts": len(recent_counts) if analyzable_for_emergence else None,
        "emerging_pt_count": emerging_count,
        "baseline_cache_status": baseline_cache,
        "recent_cache_status": recent_cache,
        "status": "ok",
        "error": None,
    }

    return summary, long_rows


# ==============================
# MAIN
# ==============================

def main():
    df = load_input_rows(INPUT_FILE)
    matched_df = filter_input_rows(df)

    if matched_df.empty:
        raise ValueError("No matched PLR prior/latest label pairs found in input file.")

    os.makedirs(os.path.dirname(OUTPUT_SUMMARY_FILE), exist_ok=True)
    os.makedirs(os.path.dirname(OUTPUT_LONG_FILE), exist_ok=True)
    os.makedirs(CACHE_DIR, exist_ok=True)

    print(f"Loaded input rows: {len(df)}")
    print(f"Rows with prior match: {df['has_prior_before_2023'].apply(safe_bool).sum()}")
    print(f"Rows after PLR/pair filtering: {len(matched_df)}")
    print("Using OpenFDA field: patient.drug.openfda.generic_name")
    print("Emerging definition: recent 5y before prior label, absent in older 5y")
    print(f"MIN_RECENT_COUNT={MIN_RECENT_COUNT}, STRICT_BASELINE_ZERO={STRICT_BASELINE_ZERO}")

    summary_rows = []
    long_rows_all = []

    total = len(matched_df)
    for idx, (_, row) in enumerate(matched_df.iterrows(), start=1):
        input_set_id = row["input_set_id"]

        try:
            summary, long_rows = analyze_one_drug(row)
            summary_rows.append(summary)
            long_rows_all.extend(long_rows)

        except Exception as e:
            summary_rows.append(
                {
                    "input_set_id": input_set_id,

                    "latest_spl_id": row.get("latest_spl_id"),
                    "latest_set_id": row.get("latest_set_id"),
                    "latest_generic_names": row.get("latest_generic_names"),
                    "latest_revised_date": row.get("latest_revised_date"),
                    "latest_is_plr": row.get("latest_is_plr"),

                    "prior_spl_id": row.get("prior_spl_id"),
                    "prior_set_id": row.get("prior_set_id"),
                    "prior_generic_names": row.get("prior_generic_names"),
                    "prior_revised_date": row.get("prior_revised_date"),
                    "prior_is_plr": row.get("prior_is_plr"),

                    "both_are_plr": row.get("both_are_plr"),

                    "faers_query_generic": choose_primary_generic(row.get("prior_generic_names")),
                    "first_faers_report_date": None,
                    "first_faers_report_cache_status": None,
                    "has_prebaseline_history": None,
                    "analyzable_for_emergence": False,

                    "baseline_start": None,
                    "baseline_end": None,
                    "recent_start": None,
                    "recent_end": None,
                    "baseline_total_reports_proxy": None,
                    "recent_total_reports_proxy": None,
                    "baseline_unique_pts": None,
                    "recent_unique_pts": None,
                    "emerging_pt_count": None,
                    "baseline_cache_status": None,
                    "recent_cache_status": None,
                    "status": "error",
                    "error": str(e),
                }
            )

        if idx % CHECKPOINT_EVERY == 0 or idx == total:
            pd.DataFrame(summary_rows).to_csv(OUTPUT_SUMMARY_FILE, index=False)
            pd.DataFrame(long_rows_all).to_csv(OUTPUT_LONG_FILE, index=False)
            ok_count = sum(1 for r in summary_rows if r["status"] == "ok")
            print(f"Processed {idx}/{total} | ok={ok_count} | long_rows={len(long_rows_all)}")

    summary_df = pd.DataFrame(summary_rows)
    long_df = pd.DataFrame(long_rows_all)

    summary_df.to_csv(OUTPUT_SUMMARY_FILE, index=False)
    long_df.to_csv(OUTPUT_LONG_FILE, index=False)

    print("\nDone.")
    print(f"Saved summary: {OUTPUT_SUMMARY_FILE}")
    print(f"Saved long file: {OUTPUT_LONG_FILE}")

    if not summary_df.empty:
        print("\nStatus counts:")
        print(summary_df["status"].value_counts(dropna=False).to_string())

        if "analyzable_for_emergence" in summary_df.columns:
            print("\nAnalyzable for emergence:")
            print(summary_df["analyzable_for_emergence"].fillna(False).value_counts(dropna=False).to_string())

        if "emerging_pt_count" in summary_df.columns:
            print("\nEmerging PT count summary:")
            print(summary_df["emerging_pt_count"].describe().to_string())


if __name__ == "__main__":
    main()