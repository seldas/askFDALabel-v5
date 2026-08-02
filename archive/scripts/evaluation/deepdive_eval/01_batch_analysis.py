#!/usr/bin/env python3
"""Standalone Deep Dive batch runner (publication freeze).

This version is self-contained and intentionally avoids Flask, SQLAlchemy,
application config objects, and hidden app state.

Notable publication-oriented revisions
-------------------------------------
- Peer selection is baseline-specific:
  - generic baseline uses only generic-name expansion
  - epc baseline uses only EPC / UNII-EPC expansion
- Peer selection is deterministic.
- MedDRA FlashText scan caching is explicit and optional.
- Caching is for section-level scan results only, not PT/SOC mapping.
- `--peer-limit all` is supported.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import random
import re
import sys
import time
import zipfile
from collections import Counter
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple, Union
import xml.etree.ElementTree as ET

import pandas as pd
import psycopg2
import requests
from flashtext import KeywordProcessor
from psycopg2.extras import RealDictCursor

LOGGER = logging.getLogger("deepdive_batch")

MEDDRA_EXCLUSION_LIST = {
    "ALL", "HIGH", "LOW", "FALL", "MAY", "CAN", "OFF", "BIT", "SET", "BAD",
    "LEAD", "MASS", "BORN", "AGE", "NORMAL", "LONG", "SKIN", "BODY", "STING",
    "GAS", "GRIP", "TALK", "WALK", "HEAL", "FEEL", "FILL", "IRON", "COKE",
}

HIERARCHY = {
    "34066-1": {"level": 3, "code": "B", "label": "Boxed Warning"},
    "34071-1": {"level": 2, "code": "W", "label": "Warning"},
    "43685-7": {"level": 2, "code": "W", "label": "Warning"},
    "34084-4": {"level": 1, "code": "A", "label": "Adverse Reaction"},
}

LEVEL_MAP = {"B": 3, "W": 2, "A": 1, "N": 0}


@dataclass(frozen=True)
class Settings:
    db_dsn: str
    spl_storage_dir: Optional[str]
    output_dir: Path
    baseline_modes: Tuple[str, ...]
    max_targets: Optional[int]
    peer_limit: Optional[int]
    peer_candidate_limit: int
    random_seed: int
    target_filter: str
    openfda_api_key: Optional[str]
    dailymed_timeout: int
    openfda_timeout: int
    include_non_rld: bool
    rerun_count: int
    use_scan_cache: bool
    cache_table: str


class PostgresDB:
    def __init__(self, dsn: str):
        self.dsn = dsn

    def connect(self):
        return psycopg2.connect(self.dsn, cursor_factory=RealDictCursor)

    def fetch_one(self, sql: str, params: Sequence | Dict | None = None):
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                return cur.fetchone()

    def fetch_all(self, sql: str, params: Sequence | Dict | None = None):
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                return cur.fetchall()

    def execute(self, sql: str, params: Sequence | Dict | None = None):
        with self.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
            conn.commit()


class LabelRepository:
    def __init__(self, db: PostgresDB, spl_storage_dir: Optional[str]):
        self.db = db
        self.spl_storage_dir = Path(spl_storage_dir).resolve() if spl_storage_dir else None

    def get_target_labels_from_file(self, file_path: str, limit: Optional[int] = None) -> List[dict]:
        try:
            with open(file_path, 'r') as f:
                set_ids = [line.strip() for line in f.readlines()]
            if limit is not None:
                set_ids = set_ids[:limit]
            targets = []
            for set_id in set_ids:
                metadata = self.get_label_metadata(set_id)
                if metadata:
                    targets.append(metadata)
            return targets
        except Exception as e:
            LOGGER.error(f"Error reading target labels from file: {e}")
            return []

    def get_target_labels(self, limit: Optional[int] = None, rld_only: bool = True) -> List[dict]:
        # Original database query method remains the same
        schema = "labeling."
        where = ["EXISTS (SELECT 1 FROM labeling.spl_sections sec WHERE sec.spl_id = s.spl_id)"]
        if rld_only:
            where.append("s.is_rld = 1")
        sql = f"""
            SELECT DISTINCT s.set_id, s.generic_names, s.epc, s.product_names, s.manufacturer,
                            s.revised_date, s.doc_type, s.is_rld, s.local_path
            FROM {schema}sum_spl s
            WHERE {' AND '.join(where)}
            ORDER BY s.revised_date DESC NULLS LAST, s.set_id
        """
        if limit is not None:
            sql += " LIMIT %s"
            return self.db.fetch_all(sql, (limit,))
        return self.db.fetch_all(sql)

    def get_label_metadata(self, set_id: str) -> Optional[dict]:
        schema = "labeling."
        row = self.db.fetch_one(f"SELECT * FROM {schema}sum_spl WHERE set_id = %s LIMIT 1", (set_id,))
        if not row:
            return None
        return {
            "set_id": row["set_id"],
            "brand_name": (row.get("product_names") or "").replace(";", ", "),
            "generic_name": (row.get("generic_names") or "").replace(";", ", "),
            "manufacturer_name": row.get("manufacturer") or "",
            "effective_time": row.get("revised_date"),
            "application_number": row.get("appr_num") or "",
            "market_category": row.get("market_categories") or "",
            "ndc": row.get("ndc_codes") or "",
            "active_ingredients": row.get("active_ingredients"),
            "labeling_type": row.get("doc_type"),
            "dosage_forms": row.get("dosage_forms"),
            "routes": row.get("routes"),
            "epc": row.get("epc"),
            "is_rld": bool(row.get("is_rld")),
            "is_rs": bool(row.get("is_rs")),
            "local_path": row.get("local_path"),
            "raw_generic_names": row.get("generic_names") or "",
        }

    def get_full_xml(self, set_id: str) -> Optional[str]:
        schema = "labeling."
        row = self.db.fetch_one(f"SELECT local_path FROM {schema}sum_spl WHERE set_id = %s", (set_id,))
        if not row or not row.get("local_path") or not self.spl_storage_dir:
            return None
        zip_path = (self.spl_storage_dir / row["local_path"]).resolve()
        if not zip_path.exists():
            LOGGER.warning("Local SPL zip does not exist for %s: %s", set_id, zip_path)
            return None
        with zipfile.ZipFile(zip_path, "r") as zf:
            xml_files = [name for name in zf.namelist() if name.lower().endswith(".xml")]
            if not xml_files:
                return None
            return zf.read(xml_files[0]).decode("utf-8", errors="replace")

    def borrow_epc(self, set_id: str, generic_names: Optional[str], openfda_api_key: Optional[str], timeout: int) -> Optional[str]:
        schema = "labeling."
        gn_list: List[str] = []
        with self.db.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(f"SELECT appr_num, generic_names FROM {schema}sum_spl WHERE set_id = %s", (set_id,))
                row = cur.fetchone()
                if not row:
                    return None
                appr_num = row.get("appr_num")
                db_generic_names = row.get("generic_names")
                if appr_num and appr_num != "N/A":
                    cur.execute(
                        f"""
                        SELECT epc FROM {schema}sum_spl
                        WHERE appr_num = %s AND epc IS NOT NULL AND epc NOT IN ('', 'N/A')
                        LIMIT 1
                        """,
                        (appr_num,),
                    )
                    hit = cur.fetchone()
                    if hit and hit.get("epc"):
                        return hit["epc"]

                gn_list = [
                    value.strip().upper()
                    for value in (generic_names or "").split(",")
                    if value.strip() and value.strip().lower() != "n/a"
                ]
                if not gn_list and db_generic_names:
                    gn_list = [value.strip().upper() for value in db_generic_names.split(";") if value.strip()]

                for gn in gn_list:
                    cur.execute(
                        f"""
                        SELECT indexing_name
                        FROM {schema}substance_indexing
                        WHERE UPPER(substance_name) = %s
                        ORDER BY CASE WHEN indexing_type = 'EPC' THEN 1
                                      WHEN indexing_type = 'MoA' THEN 2
                                      WHEN indexing_type = 'PE' THEN 3
                                      ELSE 4 END
                        LIMIT 1
                        """,
                        (gn,),
                    )
                    hit = cur.fetchone()
                    if hit and hit.get("indexing_name"):
                        return hit["indexing_name"]

                for gn in gn_list:
                    cur.execute(
                        f"""
                        SELECT epc FROM {schema}sum_spl
                        WHERE generic_names ILIKE %s AND epc IS NOT NULL AND epc NOT IN ('', 'N/A')
                        LIMIT 1
                        """,
                        (f"%{gn}%",),
                    )
                    hit = cur.fetchone()
                    if hit and hit.get("epc"):
                        return hit["epc"]

        if gn_list:
            return get_openfda_rich_metadata_by_generic(gn_list[0], openfda_api_key, timeout).get("epc")
        return None

    def _get_generic_candidates(
        self,
        generic_names: Optional[str],
        target_format: str,
        target_set_id: str,
        peer_candidate_limit: int,
        rng: random.Random,
    ) -> List[dict]:
        schema = "labeling."
        candidates: List[dict] = []
        seen = set()

        def add(row: dict, score: int):
            sid = row["set_id"]
            if sid == target_set_id or sid in seen:
                return
            seen.add(sid)
            doc_type = row.get("doc_type") or ""
            fmt = determine_doc_type_format(doc_type)
            candidates.append(
                {
                    "id": sid,
                    "is_rld": bool(row.get("is_rld")),
                    "format": fmt,
                    "score": score + (2 if fmt == target_format else 0),
                    "selection_route": "generic",
                }
            )

        name_list = [n.strip() for n in (generic_names or "").split(",") if n.strip() and n.strip().lower() != "n/a"]
        with self.db.connect() as conn:
            with conn.cursor() as cur:
                for gn in name_list[:3]:
                    cur.execute(
                        f"""
                        SELECT DISTINCT s.set_id, s.is_rld, s.doc_type
                        FROM {schema}sum_spl s
                        JOIN {schema}spl_sections sec ON s.spl_id = sec.spl_id
                        WHERE s.generic_names ILIKE %s
                        LIMIT %s
                        """,
                        (f"%{gn}%", peer_candidate_limit),
                    )
                    for row in cur.fetchall():
                        add(row, score=8)

        rng.shuffle(candidates)
        candidates.sort(key=lambda x: (x["score"], x["is_rld"], x["id"]), reverse=True)
        return candidates

    def _get_epc_candidates(
        self,
        epcs: Optional[str],
        target_format: str,
        target_set_id: str,
        peer_candidate_limit: int,
        rng: random.Random,
    ) -> List[dict]:
        schema = "labeling."
        candidates: List[dict] = []
        seen = set()

        def add(row: dict, score: int, route: str):
            sid = row["set_id"]
            if sid == target_set_id or sid in seen:
                return
            seen.add(sid)
            doc_type = row.get("doc_type") or ""
            fmt = determine_doc_type_format(doc_type)
            candidates.append(
                {
                    "id": sid,
                    "is_rld": bool(row.get("is_rld")),
                    "format": fmt,
                    "score": score + (2 if fmt == target_format else 0),
                    "selection_route": route,
                }
            )

        epc_list = [e.strip() for e in (epcs or "").split(",") if e.strip() and e.strip().lower() != "n/a"]
        with self.db.connect() as conn:
            with conn.cursor() as cur:
                try:
                    cur.execute(
                        f"""
                        WITH target_unii AS (
                            SELECT unii
                            FROM {schema}active_ingredients_map
                            WHERE spl_id = (SELECT spl_id FROM {schema}sum_spl WHERE set_id = %s LIMIT 1)
                              AND unii != ''
                        ),
                        target_epc AS (
                            SELECT DISTINCT indexing_name
                            FROM {schema}substance_indexing
                            WHERE (
                                substance_unii IN (SELECT unii FROM target_unii)
                                OR substance_name IN (
                                    SELECT substance_name
                                    FROM {schema}active_ingredients_map
                                    WHERE spl_id = (SELECT spl_id FROM {schema}sum_spl WHERE set_id = %s LIMIT 1)
                                )
                            )
                              AND indexing_type = 'EPC'
                        ),
                        related_unii AS (
                            SELECT DISTINCT substance_unii
                            FROM {schema}substance_indexing
                            WHERE indexing_name IN (SELECT indexing_name FROM target_epc)
                              AND substance_unii != ''
                        )
                        SELECT DISTINCT s.set_id, s.is_rld, s.doc_type
                        FROM {schema}sum_spl s
                        JOIN {schema}spl_sections sec ON s.spl_id = sec.spl_id
                        JOIN {schema}active_ingredients_map m ON s.spl_id = m.spl_id
                        WHERE m.unii IN (SELECT substance_unii FROM related_unii)
                        LIMIT %s
                        """,
                        (target_set_id, target_set_id, peer_candidate_limit),
                    )
                    for row in cur.fetchall():
                        add(row, score=10, route="epc_unii")
                except Exception as exc:
                    LOGGER.warning("UNII-based EPC sampling failed for %s: %s", target_set_id, exc)

                for epc in epc_list[:3]:
                    clean_epc = epc.split("[")[0].strip()
                    cur.execute(
                        f"""
                        SELECT DISTINCT generic_names
                        FROM {schema}sum_spl s
                        LEFT JOIN {schema}epc_map e ON s.spl_id = e.spl_id
                        WHERE s.epc ILIKE %s OR e.epc_term ILIKE %s OR s.epc ILIKE %s OR e.epc_term ILIKE %s
                        """,
                        (f"%{epc}%", f"%{epc}%", f"%{clean_epc}%", f"%{clean_epc}%"),
                    )
                    all_gns = set()
                    for row in cur.fetchall():
                        gn_str = row.get("generic_names")
                        if not gn_str:
                            continue
                        for g in gn_str.split(";"):
                            if g.strip():
                                all_gns.add(g.strip().upper())

                    if not all_gns:
                        continue

                    sampled_gns = sorted(all_gns)[:10]
                    where_parts = ["s.generic_names ILIKE %s"] * len(sampled_gns)
                    cur.execute(
                        f"""
                        SELECT DISTINCT s.set_id, s.is_rld, s.doc_type
                        FROM {schema}sum_spl s
                        JOIN {schema}spl_sections sec ON s.spl_id = sec.spl_id
                        WHERE {' OR '.join(where_parts)}
                        LIMIT %s
                        """,
                        [f"%{gn}%" for gn in sampled_gns] + [peer_candidate_limit],
                    )
                    for row in cur.fetchall():
                        add(row, score=5, route="epc_expansion")

        rng.shuffle(candidates)
        candidates.sort(key=lambda x: (x["score"], x["is_rld"], x["id"]), reverse=True)
        return candidates

    def get_peer_sample(
        self,
        baseline_type: str,
        generic_names: Optional[str],
        epcs: Optional[str],
        target_format: str,
        target_set_id: str,
        peer_limit: Optional[int],
        peer_candidate_limit: int,
        rng: random.Random,
    ) -> List[dict]:
        if baseline_type == "generic":
            candidates = self._get_generic_candidates(
                generic_names=generic_names,
                target_format=target_format,
                target_set_id=target_set_id,
                peer_candidate_limit=peer_candidate_limit,
                rng=rng,
            )
        elif baseline_type == "epc":
            candidates = self._get_epc_candidates(
                epcs=epcs,
                target_format=target_format,
                target_set_id=target_set_id,
                peer_candidate_limit=peer_candidate_limit,
                rng=rng,
            )
        else:
            raise ValueError(f"Unsupported baseline_type: {baseline_type}")

        return candidates if peer_limit is None else candidates[:peer_limit]


class MeddraMatcher:
    def __init__(self, db: PostgresDB, use_scan_cache: bool = False, cache_table: str = "analysis.deepdive_meddra_cache"):
        self.db = db
        self.use_scan_cache = use_scan_cache
        self.cache_table = cache_table
        self.processor = KeywordProcessor(case_sensitive=False)
        self.loaded = False

    def load_dictionary(self) -> None:
        if self.loaded:
            return
        LOGGER.info("Loading MedDRA dictionary into memory")
        with self.db.connect() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT pt_name FROM meddra_pt")
                for row in cur.fetchall():
                    name = (row["pt_name"] or "").strip()
                    if name and name.upper() not in MEDDRA_EXCLUSION_LIST and len(name) > 2:
                        self.processor.add_keyword(name)
                cur.execute("SELECT llt_name FROM meddra_llt")
                for row in cur.fetchall():
                    name = (row["llt_name"] or "").strip()
                    if name and name.upper() not in MEDDRA_EXCLUSION_LIST and len(name) > 2:
                        self.processor.add_keyword(name)
        self.loaded = True
        LOGGER.info("Loaded %d MedDRA terms into FlashText processor", len(self.processor))

    def ensure_cache_table(self) -> None:
        if not self.use_scan_cache:
            return
        self.db.execute(
            f"""
            CREATE SCHEMA IF NOT EXISTS {self.cache_table.split('.')[0]};
            CREATE TABLE IF NOT EXISTS {self.cache_table} (
                set_id TEXT NOT NULL,
                section_loinc TEXT NOT NULL,
                terms JSONB NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (set_id, section_loinc)
            )
            """
        )

    def get_cached_scan(self, set_id: str, section_loinc: str) -> Optional[List[str]]:
        if not self.use_scan_cache:
            return None
        row = self.db.fetch_one(
            f"SELECT terms FROM {self.cache_table} WHERE set_id = %s AND section_loinc = %s",
            (set_id, section_loinc),
        )
        if not row:
            return None
        terms = row.get("terms")
        return terms if isinstance(terms, list) else list(terms or [])

    def save_scan_to_cache(self, set_id: str, section_loinc: str, terms: List[str]) -> None:
        if not self.use_scan_cache:
            return
        self.db.execute(
            f"""
            INSERT INTO {self.cache_table} (set_id, section_loinc, terms, created_at)
            VALUES (%s, %s, %s::jsonb, NOW())
            ON CONFLICT (set_id, section_loinc)
            DO UPDATE SET terms = EXCLUDED.terms, created_at = NOW()
            """,
            (set_id, section_loinc, json.dumps(terms)),
        )

    def scan_text(self, text: str) -> List[str]:
        if not self.loaded:
            self.load_dictionary()
        if not text:
            return []
        return sorted(set(self.processor.extract_keywords(text)))

    def scan_section(self, text: str, set_id: Optional[str], section_loinc: Optional[str]) -> Tuple[List[str], bool]:
        if self.use_scan_cache and set_id and section_loinc:
            cached = self.get_cached_scan(set_id, section_loinc)
            if cached is not None:
                return cached, True
        terms = self.scan_text(text)
        if self.use_scan_cache and set_id and section_loinc:
            self.save_scan_to_cache(set_id, section_loinc, terms)
        return terms, False

    def get_meddra_mappings(self, terms: Iterable[str]) -> Dict[str, dict]:
        terms = sorted({term for term in terms if term})
        if not terms:
            return {}
        pt_map: Dict[str, dict] = {}
        with self.db.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT llt.llt_name, pt.pt_name, mdhier.soc_name
                    FROM meddra_llt llt
                    JOIN meddra_pt pt ON llt.pt_code = pt.pt_code
                    JOIN meddra_mdhier mdhier ON pt.pt_code = mdhier.pt_code
                    WHERE llt.llt_name = ANY(%s)
                    """,
                    (terms,),
                )
                for row in cur.fetchall():
                    pt_map[row["llt_name"].upper()] = {"pt": row["pt_name"].upper(), "soc": row["soc_name"]}
                cur.execute(
                    """
                    SELECT pt.pt_name, mdhier.soc_name
                    FROM meddra_pt pt
                    JOIN meddra_mdhier mdhier ON pt.pt_code = mdhier.pt_code
                    WHERE pt.pt_name = ANY(%s)
                    """,
                    (terms,),
                )
                for row in cur.fetchall():
                    pt_map[row["pt_name"].upper()] = {"pt": row["pt_name"].upper(), "soc": row["soc_name"]}
        return pt_map


def get_openfda_rich_metadata_by_generic(generic_name: str, api_key: Optional[str], timeout: int) -> dict:
    if not generic_name or generic_name.lower() == "n/a":
        return {}
    clean_name = re.split(r"[,;]", generic_name)[0].strip()
    params = {"search": f'openfda.generic_name:"{clean_name}"', "limit": 5}
    if api_key:
        params["api_key"] = api_key
    try:
        resp = requests.get("https://api.fda.gov/drug/label.json", params=params, timeout=timeout)
        resp.raise_for_status()
        payload = resp.json()
        for result in payload.get("results", []):
            openfda = result.get("openfda", {})
            if openfda.get("pharm_class_epc"):
                return {
                    "epc": ", ".join(openfda.get("pharm_class_epc", [])),
                    "moa": ", ".join(openfda.get("pharm_class_moa", [])),
                    "generic_name": ", ".join(openfda.get("generic_name", [])),
                }
    except Exception as exc:
        LOGGER.warning("openFDA rich metadata lookup failed for %s: %s", generic_name, exc)
    return {}


def get_label_xml(set_id: str, repo: LabelRepository, dailymed_timeout: int) -> Optional[str]:
    xml_content = repo.get_full_xml(set_id)
    if xml_content:
        return xml_content
    try:
        resp = requests.get(
            f"https://dailymed.nlm.nih.gov/dailymed/services/v2/spls/{set_id}.xml",
            timeout=dailymed_timeout,
        )
        resp.raise_for_status()
        return resp.text
    except Exception as exc:
        LOGGER.warning("Failed to retrieve XML for %s from local storage or DailyMed: %s", set_id, exc)
        return None


def extract_sections_by_loinc(xml_content: str) -> Dict[str, dict]:
    sections: Dict[str, dict] = {}
    if not xml_content:
        return sections
    try:
        clean_xml = xml_content.encode("ascii", "ignore").decode("ascii")
        root = ET.fromstring(clean_xml)
        ns = {"v3": "urn:hl7-org:v3"}

        def local(tag: str) -> str:
            return tag.split("}")[-1] if "}" in tag else tag

        found_sections = root.findall(".//v3:section", ns)
        if not found_sections:
            found_sections = [s for s in root.iter() if local(s.tag) == "section"]

        for section in found_sections:
            code_el = section.find("v3:code", ns)
            if code_el is None:
                code_el = next((c for c in section if local(c.tag) == "code"), None)
            if code_el is None:
                continue
            loinc = code_el.get("code")
            if not loinc:
                continue
            title_el = section.find("v3:title", ns)
            if title_el is None:
                title_el = next((t for t in section if local(t.tag) == "title"), None)
            title = "".join(title_el.itertext()).strip() if title_el is not None else loinc
            content = "".join(section.itertext()).strip()
            if loinc not in sections or len(content) > len(sections[loinc]["content"]):
                sections[loinc] = {"title": title, "content": content}
    except Exception as exc:
        LOGGER.warning("Section extraction failed: %s", exc)
    return sections


def determine_label_format(sections_dict: Dict[str, dict]) -> str:
    if "43685-7" in sections_dict:
        return "PLR"
    if "34084-4" in sections_dict:
        return "non-PLR"
    return "OTC"


def determine_doc_type_format(doc_type: str) -> str:
    text = (doc_type or "").upper()
    if "PRESCRIPTION" in text:
        return "PLR"
    if "OTC" in text:
        return "OTC"
    return "OTC"


def normalize_to_pt_levels(raw_data_dict: Dict[str, List[str]], mappings: Dict[str, dict]) -> Dict[str, dict]:
    pt_levels: Dict[str, dict] = {}
    for loinc, terms in raw_data_dict.items():
        lvl_info = HIERARCHY[loinc]
        for term in terms:
            mapping = mappings.get(term.upper())
            if not mapping:
                continue
            pt = mapping["pt"]
            cur = pt_levels.get(pt, {"level": 0, "originals": set()})
            originals = cur["originals"]
            originals.add(term)
            if lvl_info["level"] > cur["level"]:
                pt_levels[pt] = {**lvl_info, "soc": mapping["soc"], "originals": originals}
            else:
                pt_levels[pt]["originals"] = originals
    for pt in pt_levels:
        pt_levels[pt]["originals"] = sorted(pt_levels[pt]["originals"])
    return pt_levels


def analyze_one_label(
    target_set_id: str,
    repo: LabelRepository,
    matcher: MeddraMatcher,
    settings: Settings,
    baseline_type: str,
    baseline_term: Optional[str],
    run_id: str,
    code_version: str,
    rng: random.Random,
) -> dict:
    started = time.perf_counter()
    target_xml = get_label_xml(target_set_id, repo, settings.dailymed_timeout)
    if not target_xml:
        raise RuntimeError("Target XML not found")

    target_sections = extract_sections_by_loinc(target_xml)
    target_format = determine_label_format(target_sections)
    metadata = repo.get_label_metadata(target_set_id) or {}

    active_generic_names = metadata.get("raw_generic_names") or metadata.get("generic_name") or ""
    active_epcs = metadata.get("epc") or ""
    if baseline_type == "epc" and (not active_epcs or str(active_epcs).lower() == "n/a"):
        active_epcs = repo.borrow_epc(target_set_id, active_generic_names, settings.openfda_api_key, settings.openfda_timeout)
    elif baseline_type not in {"generic", "epc"}:
        raise ValueError(f"Unsupported baseline_type: {baseline_type}")

    peer_candidates = repo.get_peer_sample(
        baseline_type=baseline_type,
        generic_names=active_generic_names,
        epcs=active_epcs,
        target_format=target_format,
        target_set_id=target_set_id,
        peer_limit=settings.peer_limit,
        peer_candidate_limit=settings.peer_candidate_limit,
        rng=rng,
    )

    cache_hits = 0
    cache_misses = 0

    def scan_sections(sections_dict: Dict[str, dict], set_id: str) -> Dict[str, List[str]]:
        nonlocal cache_hits, cache_misses
        raw_data: Dict[str, List[str]] = {}
        for loinc, data in sections_dict.items():
            if loinc not in HIERARCHY:
                continue
            text = data.get("content", "")
            if not text:
                continue
            terms, is_cached = matcher.scan_section(text=text, set_id=set_id, section_loinc=loinc)
            raw_data[loinc] = terms
            if is_cached:
                cache_hits += 1
            else:
                cache_misses += 1
        return raw_data

    target_raw = scan_sections(target_sections, target_set_id)
    peers_raw = []
    peers_metadata = {}
    all_unique_terms = set()

    for peer in peer_candidates:
        peer_id = peer["id"]
        peer_meta = repo.get_label_metadata(peer_id)
        if peer_meta:
            peers_metadata[peer_id] = {
                "brand": peer_meta.get("brand_name", "Unknown"),
                "manufacturer": peer_meta.get("manufacturer_name", "Unknown"),
            }
        peer_xml = get_label_xml(peer_id, repo, settings.dailymed_timeout)
        if not peer_xml:
            continue
        peer_sections = extract_sections_by_loinc(peer_xml)
        peer_raw = scan_sections(peer_sections, peer_id)
        peers_raw.append({"id": peer_id, "data": peer_raw, "meta": peer})
        for loinc_terms in peer_raw.values():
            all_unique_terms.update(loinc_terms)

    for loinc_terms in target_raw.values():
        all_unique_terms.update(loinc_terms)
    mappings = matcher.get_meddra_mappings(all_unique_terms)

    target_pt_levels = normalize_to_pt_levels(target_raw, mappings)
    peers_pt_data = [{"id": p["id"], "pts": normalize_to_pt_levels(p["data"], mappings), "meta": p["meta"]} for p in peers_raw]

    all_pts = set(target_pt_levels.keys())
    for peer in peers_pt_data:
        all_pts.update(peer["pts"].keys())

    total_peers = len(peers_pt_data)
    term_stats: Dict[str, dict] = {}
    for pt in sorted(all_pts):
        peer_codes = [peer["pts"].get(pt, {"code": "N"})["code"] for peer in peers_pt_data]
        counts = Counter(peer_codes)
        dist = {
            "B": round((counts["B"] / total_peers * 100) if total_peers > 0 else 0),
            "W": round((counts["W"] / total_peers * 100) if total_peers > 0 else 0),
            "A": round((counts["A"] / total_peers * 100) if total_peers > 0 else 0),
            "N": round((counts["N"] / total_peers * 100) if total_peers > 0 else 0),
        }
        consensus_code = counts.most_common(1)[0][0] if counts else "N"
        target_status = target_pt_levels.get(pt, {"level": 0, "code": "N", "soc": "Unknown", "originals": []})
        soc = target_status.get("soc", "Unknown")
        if soc == "Unknown":
            peer_soc = next((peer["pts"][pt].get("soc") for peer in peers_pt_data if pt in peer["pts"]), None)
            if peer_soc:
                soc = peer_soc
        target_level = LEVEL_MAP[target_status["code"]]
        consensus_level = LEVEL_MAP[consensus_code]
        peer_count = sum(1 for code in peer_codes if code != "N")
        peer_coverage = (peer_count / total_peers * 100) if total_peers > 0 else 0
        term_stats[pt] = {
            "term": pt,
            "originals": target_status.get("originals", []),
            "soc": soc,
            "target_code": target_status["code"],
            "target_level": target_level,
            "consensus_code": consensus_code,
            "consensus_level": consensus_level,
            "distribution": dist,
            "peer_coverage": peer_coverage,
            "peer_count": peer_count,
            "weight": consensus_level * peer_coverage,
            "peers": peer_codes,
        }

    tiers = {"critical": [], "moderate": [], "minor": []}
    matrix_rows = []
    anomaly_rows = []

    for pt, stats in term_stats.items():
        is_downgraded = stats["target_level"] < stats["consensus_level"] and stats["consensus_level"] > 0
        is_missing = stats["target_level"] == 0 and stats["consensus_level"] > 0 and stats["peer_coverage"] >= 50
        tier = None
        note = None
        if is_missing:
            tier = "critical" if stats["consensus_level"] >= 2 else "moderate"
            note = f"Missing Signal: Class consensus is {stats['consensus_code']}."
            stats["note"] = note
            tiers[tier].append(stats)
        elif is_downgraded:
            tier = "moderate"
            note = f"Downgraded: Peer consensus ({stats['consensus_code']}) is higher level."
            stats["note"] = note
            tiers["moderate"].append(stats)

        is_discrepancy = stats["target_code"] != stats["consensus_code"]
        if is_discrepancy and not is_missing and not is_downgraded and stats["peer_coverage"] > 20:
            tier = tier or "minor"
            note = note or "Non-consensus discrepancy"
            stats["note"] = note
            tiers["minor"].append(stats)

        if stats["peer_coverage"] > 10 or is_discrepancy or stats["target_level"] >= 2:
            matrix_rows.append(
                {
                    "term": pt,
                    "originals": stats["originals"],
                    "soc": stats["soc"],
                    "target": stats["target_code"],
                    "consensus": stats["consensus_code"],
                    "coverage": f"{int(stats['peer_coverage'])}%",
                    "dist": stats["distribution"],
                    "peers": stats["peers"],
                    "is_discrepancy": is_discrepancy,
                }
            )

        if tier:
            anomaly_rows.append(
                {
                    "run_id": run_id,
                    "target_set_id": target_set_id,
                    "baseline_type": baseline_type,
                    "baseline_term": baseline_term,
                    "soc": stats["soc"],
                    "pt_term": pt,
                    "tier": tier,
                    "target_code": stats["target_code"],
                    "consensus_code": stats["consensus_code"],
                    "coverage": round(stats["peer_coverage"], 2),
                    "peer_distribution_B": stats["distribution"]["B"],
                    "peer_distribution_W": stats["distribution"]["W"],
                    "peer_distribution_A": stats["distribution"]["A"],
                    "peer_distribution_N": stats["distribution"]["N"],
                    "original_match": "; ".join(stats["originals"]),
                    "note": note,
                }
            )

    matrix_rows.sort(key=lambda x: (LEVEL_MAP.get(x["target"], 0), x["term"]), reverse=True)
    for key in tiers:
        tiers[key].sort(key=lambda x: x["weight"], reverse=True)

    elapsed_seconds = round(time.perf_counter() - started, 3)
    return {
        "run_id": run_id,
        "run_timestamp": datetime.now(timezone.utc).isoformat(),
        "code_version": code_version,
        "target_set_id": target_set_id,
        "source": "local",
        "baseline_type": baseline_type,
        "baseline_term": baseline_term,
        "peer_count": total_peers,
        "label_format": target_format,
        "critical_gap_count": len(tiers["critical"]),
        "regulatory_discrepancy_count": len(tiers["moderate"]),
        "minor_discrepancy_count": len(tiers["minor"]),
        "matrix_term_count": len(matrix_rows),
        "success_flag": True,
        "error_message": None,
        "elapsed_seconds": elapsed_seconds,
        "borrowed_epc": active_epcs,
        "target_metadata": metadata,
        "matrix": matrix_rows,
        "tiers": tiers,
        "peers_metadata": peers_metadata,
        "peer_candidates": peer_candidates,
        "anomaly_rows": anomaly_rows,
        "cache_hits": cache_hits,
        "cache_misses": cache_misses,
    }


def infer_code_version(explicit_value: Optional[str] = None) -> str:
    if explicit_value:
        return explicit_value
    for env_name in ("GIT_COMMIT", "COMMIT_SHA", "CODE_VERSION"):
        value = os.getenv(env_name)
        if value:
            return value
    return "standalone-publication-freeze-v2"


def parse_peer_limit(value: str) -> Optional[int]:
    if value.lower() == "all":
        return None
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("peer-limit must be a positive integer or 'all'")
    return parsed


def parse_args(argv: Optional[Sequence[str]] = None) -> Settings:
    parser = argparse.ArgumentParser(description="Standalone Deep Dive batch runner")
    parser.add_argument("--db-dsn", default=os.getenv("ASKFDALABEL_DB_DSN", "postgresql://afd_user:afd_password@localhost:5432/askfdalabel"))
    parser.add_argument("--spl-storage-dir", default=os.getenv("SPL_STORAGE_DIR"))
    parser.add_argument("--output-dir", default=os.getenv("DEEPDIVE_OUTPUT_DIR", "./deepdive_outputs"))
    parser.add_argument("--baseline-modes", default=os.getenv("DEEPDIVE_BASELINE_MODES", "epc,generic"), help="Comma-separated: epc,generic")
    parser.add_argument("--max-targets", type=int, default=int(os.getenv("DEEPDIVE_MAX_TARGETS", "0")) or None)
    parser.add_argument("--peer-limit", type=parse_peer_limit, default=parse_peer_limit(os.getenv("DEEPDIVE_PEER_LIMIT", "25")), help="Positive integer or 'all'")
    parser.add_argument("--peer-candidate-limit", type=int, default=int(os.getenv("DEEPDIVE_PEER_CANDIDATE_LIMIT", "100")))
    parser.add_argument("--random-seed", type=int, default=int(os.getenv("DEEPDIVE_RANDOM_SEED", "20260409")))
    parser.add_argument("--target-filter", default=os.getenv("DEEPDIVE_TARGET_FILTER", "rld"), choices=["rld", "all"])
    parser.add_argument("--openfda-api-key", default=os.getenv("OPENFDA_API_KEY"))
    parser.add_argument("--dailymed-timeout", type=int, default=int(os.getenv("DAILYMED_TIMEOUT", "20")))
    parser.add_argument("--openfda-timeout", type=int, default=int(os.getenv("OPENFDA_TIMEOUT", "20")))
    parser.add_argument("--rerun-count", type=int, default=int(os.getenv("DEEPDIVE_RERUN_COUNT", "1")))
    parser.add_argument("--use-scan-cache", action="store_true", default=os.getenv("DEEPDIVE_USE_SCAN_CACHE", "0") == "1")
    parser.add_argument("--cache-table", default=os.getenv("DEEPDIVE_CACHE_TABLE", "analysis.deepdive_meddra_cache"))
    args = parser.parse_args(argv)

    baseline_modes = tuple(mode.strip().lower() for mode in args.baseline_modes.split(",") if mode.strip())
    invalid = [mode for mode in baseline_modes if mode not in {"epc", "generic"}]
    if invalid:
        parser.error(f"Unsupported baseline modes: {', '.join(invalid)}")

    return Settings(
        db_dsn=args.db_dsn,
        spl_storage_dir=args.spl_storage_dir,
        output_dir=Path(args.output_dir).resolve(),
        baseline_modes=baseline_modes,
        max_targets=args.max_targets,
        peer_limit=args.peer_limit,
        peer_candidate_limit=args.peer_candidate_limit,
        random_seed=args.random_seed,
        target_filter=args.target_filter,
        openfda_api_key=args.openfda_api_key,
        dailymed_timeout=args.dailymed_timeout,
        openfda_timeout=args.openfda_timeout,
        include_non_rld=args.target_filter == "all",
        rerun_count=max(1, args.rerun_count),
        use_scan_cache=args.use_scan_cache,
        cache_table=args.cache_table,
    )


def setup_logging(output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    logfile = output_dir / "deepdive_batch.log"
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        handlers=[logging.StreamHandler(sys.stdout), logging.FileHandler(logfile, encoding="utf-8")],
    )


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2, default=str)


def main(argv: Optional[Sequence[str]] = None) -> int:
    settings = parse_args(argv)
    setup_logging(settings.output_dir)
    LOGGER.info("Starting standalone Deep Dive batch run")
    LOGGER.info("Output directory: %s", settings.output_dir)

    db = PostgresDB(settings.db_dsn)
    repo = LabelRepository(db, settings.spl_storage_dir)
    matcher = MeddraMatcher(db, use_scan_cache=settings.use_scan_cache, cache_table=settings.cache_table)
    if settings.use_scan_cache:
        matcher.ensure_cache_table()

    code_version = infer_code_version()
    run_id = datetime.now(timezone.utc).strftime("deepdive_%Y%m%dT%H%M%SZ")
    run_dir = settings.output_dir / run_id
    raw_dir = run_dir / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)

    targets = repo.get_target_labels_from_file('./scripts/evaluation/rld_list.txt', limit=settings.max_targets)
    LOGGER.info("Loaded %d target labels", len(targets))

    rng = random.Random(settings.random_seed)
    summary_rows: List[dict] = []
    anomaly_rows: List[dict] = []
    peer_rows: List[dict] = []

    for idx, target in enumerate(targets, start=1):
        target_set_id = target["set_id"]
        LOGGER.info("[%d/%d] Processing target %s", idx, len(targets), target_set_id)

        for baseline_type in settings.baseline_modes:
            for rerun_index in range(settings.rerun_count):
                baseline_term = target.get("epc") if baseline_type == "epc" else target.get("generic_names")
                try:
                    result = analyze_one_label(
                        target_set_id=target_set_id,
                        repo=repo,
                        matcher=matcher,
                        settings=settings,
                        baseline_type=baseline_type,
                        baseline_term=baseline_term,
                        run_id=run_id,
                        code_version=code_version,
                        rng=rng,
                    )
                    result["rerun_index"] = rerun_index
                    write_json(raw_dir / f"{target_set_id}__{baseline_type}__run{rerun_index}.json", result)
                    summary_rows.append(
                        {
                            key: result.get(key)
                            for key in [
                                "run_id", "run_timestamp", "code_version", "target_set_id", "source",
                                "baseline_type", "baseline_term", "peer_count", "label_format",
                                "critical_gap_count", "regulatory_discrepancy_count", "minor_discrepancy_count",
                                "matrix_term_count", "success_flag", "error_message", "elapsed_seconds",
                                "cache_hits", "cache_misses",
                            ]
                        }
                        | {"rerun_index": rerun_index}
                    )
                    anomaly_rows.extend([row | {"rerun_index": rerun_index} for row in result["anomaly_rows"]])
                    for peer in result.get("peer_candidates", []):
                        peer_meta = result.get("peers_metadata", {}).get(peer["id"], {})
                        peer_rows.append(
                            {
                                "run_id": run_id,
                                "target_set_id": target_set_id,
                                "peer_set_id": peer["id"],
                                "baseline_type": baseline_type,
                                "baseline_term": baseline_term,
                                "peer_brand": peer_meta.get("brand", "Unknown"),
                                "peer_manufacturer": peer_meta.get("manufacturer", "Unknown"),
                                "peer_is_rld": peer.get("is_rld"),
                                "peer_format": peer.get("format"),
                                "peer_score": peer.get("score"),
                                "selection_route": peer.get("selection_route"),
                                "rerun_index": rerun_index,
                            }
                        )
                except Exception as exc:
                    LOGGER.exception("Analysis failed for %s (%s): %s", target_set_id, baseline_type, exc)
                    summary_rows.append(
                        {
                            "run_id": run_id,
                            "run_timestamp": datetime.now(timezone.utc).isoformat(),
                            "code_version": code_version,
                            "target_set_id": target_set_id,
                            "source": "local",
                            "baseline_type": baseline_type,
                            "baseline_term": baseline_term,
                            "peer_count": 0,
                            "label_format": None,
                            "critical_gap_count": None,
                            "regulatory_discrepancy_count": None,
                            "minor_discrepancy_count": None,
                            "matrix_term_count": None,
                            "success_flag": False,
                            "error_message": str(exc),
                            "elapsed_seconds": None,
                            "cache_hits": None,
                            "cache_misses": None,
                            "rerun_index": rerun_index,
                        }
                    )

    summary_df = pd.DataFrame(summary_rows)
    anomaly_df = pd.DataFrame(anomaly_rows)
    peer_df = pd.DataFrame(peer_rows)

    run_dir.mkdir(parents=True, exist_ok=True)
    summary_df.to_csv(run_dir / "deepdive_batch_results.csv", index=False)
    anomaly_df.to_csv(run_dir / "deepdive_anomalies.csv", index=False)
    peer_df.to_csv(run_dir / "deepdive_peers.csv", index=False)
    write_json(
        run_dir / "run_settings.json",
        {
            "run_id": run_id,
            "settings": {**asdict(settings), "output_dir": str(settings.output_dir)},
            "code_version": code_version,
            "n_targets": len(targets),
            "n_summary_rows": len(summary_rows),
            "n_anomaly_rows": len(anomaly_rows),
            "n_peer_rows": len(peer_rows),
        },
    )

    LOGGER.info("Batch analysis completed")
    LOGGER.info("Summary CSV: %s", run_dir / "deepdive_batch_results.csv")
    LOGGER.info("Anomaly CSV: %s", run_dir / "deepdive_anomalies.csv")
    LOGGER.info("Peer CSV: %s", run_dir / "deepdive_peers.csv")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
