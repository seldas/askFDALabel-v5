# scripts/semantic_core/agents/postprocess.py
import re
import hashlib
from collections import defaultdict

_WS_RE = re.compile(r"\s+")
_PUNCT_RE = re.compile(r"[^\w\s]")

def _norm_text(s: str) -> str:
    s = (s or "").lower()
    s = _WS_RE.sub(" ", s).strip()
    # remove punctuation to catch tiny variations
    s = _PUNCT_RE.sub("", s)
    s = _WS_RE.sub(" ", s).strip()
    return s

def _fingerprint(text: str, n: int = 400) -> str:
    """
    Cheap near-dup fingerprint: normalize + take first N chars + sha1.
    Works well for repeated paragraphs with minor formatting differences.
    """
    t = _norm_text(text)[:n]
    return hashlib.sha1(t.encode("utf-8")).hexdigest()

def run_postprocess(state):
    """
    Normalize output for frontend compatibility:
      - ensure required fields exist
      - enforce min_score
      - near-duplicate dedupe by text
      - cap chunks per label (set_id)
    """
    state.agent_flow.append("postprocess")

    cfg = getattr(state, "config", {}) or {}
    min_score = float(cfg.get("min_score", 0.0) or 0.0)

    # NEW: optional caps
    max_per_set_id = int(cfg.get("max_per_set_id", 4) or 4)
    max_total = int(cfg.get("max_total_results", 10) or 10)

    results = state.retrieval.get("results", []) or []

    filtered = []
    seen_fp = set()
    per_label_counts = defaultdict(int)

    for r in results:
        # normalize required fields
        r.setdefault("drug_name", r.get("drug") or "")
        r.setdefault("section", r.get("section_title") or r.get("section") or "")
        r.setdefault("text", r.get("chunk_text") or r.get("text") or "")

        source = r.get("source") or {}
        set_id = source.get("set_id") or r.get("set_id")
        spl_id = source.get("spl_id") or r.get("spl_id")
        r["source"] = {"set_id": set_id, "spl_id": spl_id, **source}

        # enforce min_score
        score = float(r.get("score", 0.0) or 0.0)
        if score < min_score:
            continue

        # require some text
        if not r["text"] or len(r["text"]) < 25:
            continue

        # cap per label
        if set_id:
            if per_label_counts[set_id] >= max_per_set_id:
                continue

        # near-duplicate dedupe
        fp = _fingerprint(r["text"])
        if fp in seen_fp:
            continue
        seen_fp.add(fp)

        filtered.append(r)

        if set_id:
            per_label_counts[set_id] += 1

        if len(filtered) >= max_total:
            break

    state.retrieval["results"] = filtered
    state.flags["next_step"] = "evidence_fetcher"