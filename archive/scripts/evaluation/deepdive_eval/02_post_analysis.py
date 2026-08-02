#!/usr/bin/env python3
"""Post-analysis for standalone Deep Dive batch outputs.

Inputs
- deepdive_batch_results.csv
- deepdive_anomalies.csv

Outputs
- analysis_summary.json
- overall_summary.csv
- baseline_summary.csv
- label_format_summary.csv
- top_targets_by_critical.csv
- top_targets_by_regulatory.csv
- peer_count_summary.csv
- soc_summary.csv
- case_candidates.csv
- manuscript_results.md

Design goal
- characterize system behavior at scale
- prioritize observations and candidate case studies
- avoid making claim-level validation assertions
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Dict, List

import pandas as pd


def pct(n, d):
    return round((100.0 * n / d), 2) if d else 0.0


def safe_mode(series: pd.Series):
    s = series.dropna()
    if s.empty:
        return None
    m = s.mode()
    return None if m.empty else m.iloc[0]


def summarize_results(results: pd.DataFrame) -> Dict:
    total_runs = len(results)
    success_runs = int(results["success_flag"].fillna(False).astype(bool).sum())
    failed_runs = total_runs - success_runs
    targets = results["target_set_id"].nunique()
    baselines = sorted(results["baseline_type"].dropna().unique().tolist())

    return {
        "n_runs": int(total_runs),
        "n_success_runs": int(success_runs),
        "n_failed_runs": int(failed_runs),
        "success_rate_pct": pct(success_runs, total_runs),
        "n_unique_targets": int(targets),
        "baseline_types": baselines,
        "n_runs_with_zero_peers": int((results["peer_count"].fillna(0) == 0).sum()),
        "pct_runs_with_zero_peers": pct(int((results["peer_count"].fillna(0) == 0).sum()), total_runs),
        "median_peer_count": float(results["peer_count"].fillna(0).median()),
        "mean_peer_count": round(float(results["peer_count"].fillna(0).mean()), 3),
        "median_elapsed_seconds": round(float(results["elapsed_seconds"].dropna().median()), 3) if results["elapsed_seconds"].notna().any() else None,
    }


def make_overall_summary(results: pd.DataFrame) -> pd.DataFrame:
    rows = []
    numeric_cols = [
        "peer_count",
        "critical_gap_count",
        "regulatory_discrepancy_count",
        "minor_discrepancy_count",
        "matrix_term_count",
        "elapsed_seconds",
        "cache_hits",
        "cache_misses",
    ]
    for col in numeric_cols:
        s = results[col].dropna() if col in results.columns else pd.Series(dtype=float)
        rows.append({
            "metric": col,
            "count": int(s.shape[0]),
            "mean": round(float(s.mean()), 4) if not s.empty else None,
            "median": round(float(s.median()), 4) if not s.empty else None,
            "p25": round(float(s.quantile(0.25)), 4) if not s.empty else None,
            "p75": round(float(s.quantile(0.75)), 4) if not s.empty else None,
            "min": round(float(s.min()), 4) if not s.empty else None,
            "max": round(float(s.max()), 4) if not s.empty else None,
        })
    return pd.DataFrame(rows)


def make_baseline_summary(results: pd.DataFrame) -> pd.DataFrame:
    g = results.groupby("baseline_type", dropna=False)
    out = g.agg(
        runs=("target_set_id", "size"),
        unique_targets=("target_set_id", "nunique"),
        success_runs=("success_flag", lambda s: int(pd.Series(s).fillna(False).astype(bool).sum())),
        zero_peer_runs=("peer_count", lambda s: int((pd.Series(s).fillna(0) == 0).sum())),
        mean_peer_count=("peer_count", "mean"),
        median_peer_count=("peer_count", "median"),
        mean_critical=("critical_gap_count", "mean"),
        median_critical=("critical_gap_count", "median"),
        mean_regulatory=("regulatory_discrepancy_count", "mean"),
        median_regulatory=("regulatory_discrepancy_count", "median"),
        mean_minor=("minor_discrepancy_count", "mean"),
        median_minor=("minor_discrepancy_count", "median"),
        mean_matrix_terms=("matrix_term_count", "mean"),
        median_matrix_terms=("matrix_term_count", "median"),
        mean_elapsed=("elapsed_seconds", "mean"),
    ).reset_index()
    out["success_rate_pct"] = out.apply(lambda r: pct(r["success_runs"], r["runs"]), axis=1)
    out["zero_peer_rate_pct"] = out.apply(lambda r: pct(r["zero_peer_runs"], r["runs"]), axis=1)
    return out.sort_values("baseline_type")


def make_label_format_summary(results: pd.DataFrame) -> pd.DataFrame:
    out = results.groupby(["baseline_type", "label_format"], dropna=False).agg(
        runs=("target_set_id", "size"),
        mean_peer_count=("peer_count", "mean"),
        median_peer_count=("peer_count", "median"),
        mean_critical=("critical_gap_count", "mean"),
        median_critical=("critical_gap_count", "median"),
        mean_regulatory=("regulatory_discrepancy_count", "mean"),
        median_regulatory=("regulatory_discrepancy_count", "median"),
        mean_minor=("minor_discrepancy_count", "mean"),
        median_minor=("minor_discrepancy_count", "median"),
    ).reset_index()
    return out.sort_values(["baseline_type", "label_format"])


def make_peer_count_summary(results: pd.DataFrame) -> pd.DataFrame:
    bins = [-1, 0, 1, 5, 10, 25, 50, 100, 1000000]
    labels = ["0", "1", "2-5", "6-10", "11-25", "26-50", "51-100", ">100"]
    work = results.copy()
    work["peer_bin"] = pd.cut(work["peer_count"].fillna(0), bins=bins, labels=labels)
    out = work.groupby(["baseline_type", "peer_bin"], dropna=False).agg(
        runs=("target_set_id", "size"),
        mean_critical=("critical_gap_count", "mean"),
        mean_regulatory=("regulatory_discrepancy_count", "mean"),
        mean_minor=("minor_discrepancy_count", "mean"),
    ).reset_index()
    return out


def prepare_top_targets(results: pd.DataFrame, score_col: str, top_n: int = 30) -> pd.DataFrame:
    cols = [
        "target_set_id", "baseline_type", "baseline_term", "label_format", "peer_count",
        "critical_gap_count", "regulatory_discrepancy_count", "minor_discrepancy_count",
        "matrix_term_count", "elapsed_seconds"
    ]
    work = results[cols].copy()
    work[score_col] = work[score_col].fillna(0)
    return work.sort_values([score_col, "peer_count", "matrix_term_count"], ascending=[False, False, False]).head(top_n)


def summarize_anomalies(anom: pd.DataFrame) -> Dict:
    return {
        "n_anomalies": int(len(anom)),
        "n_unique_targets_with_anomalies": int(anom["target_set_id"].nunique()),
        "tier_counts": anom["tier"].value_counts(dropna=False).to_dict(),
        "baseline_counts": anom["baseline_type"].value_counts(dropna=False).to_dict(),
    }


def make_soc_summary(anom: pd.DataFrame) -> pd.DataFrame:
    out = anom.groupby(["baseline_type", "tier", "soc"], dropna=False).agg(
        anomaly_count=("pt_term", "size"),
        unique_targets=("target_set_id", "nunique"),
        median_coverage=("coverage", "median"),
        mean_coverage=("coverage", "mean"),
    ).reset_index()
    return out.sort_values(["baseline_type", "tier", "anomaly_count"], ascending=[True, True, False])


def make_case_candidates(results: pd.DataFrame, anom: pd.DataFrame, top_n: int = 40) -> pd.DataFrame:
    anom_counts = anom.groupby(["target_set_id", "baseline_type", "tier"], dropna=False).size().unstack(fill_value=0).reset_index()
    merged = results.merge(anom_counts, on=["target_set_id", "baseline_type"], how="left")
    for col in ["critical", "moderate", "minor"]:
        if col not in merged.columns:
            merged[col] = 0
    merged["case_score"] = (
        merged["critical_gap_count"].fillna(0) * 3
        + merged["regulatory_discrepancy_count"].fillna(0) * 2
        + merged["peer_count"].fillna(0) * 0.2
    )
    keep = [
        "target_set_id", "baseline_type", "baseline_term", "label_format", "peer_count",
        "critical_gap_count", "regulatory_discrepancy_count", "minor_discrepancy_count",
        "critical", "moderate", "minor", "matrix_term_count", "elapsed_seconds", "case_score"
    ]
    return merged[keep].sort_values(["case_score", "peer_count", "critical_gap_count"], ascending=[False, False, False]).head(top_n)


def build_manuscript_text(summary: Dict, anomaly_summary: Dict, baseline_df: pd.DataFrame, format_df: pd.DataFrame, top_critical: pd.DataFrame, top_reg: pd.DataFrame) -> str:
    lines: List[str] = []
    lines.append("# Deep Dive Evaluation Results\n")
    lines.append("## Analytical framing\n")
    lines.append(
        "These analyses characterize population-level behavior of the Deep Dive function across the batch run. "
        "They are intended to support exploratory interpretation, outlier review, and case-study selection rather than claim-level validation of every flagged signal.\n"
    )
    lines.append("## Batch run overview\n")
    lines.append(
        f"The batch run included {summary['n_runs']} analysis runs across {summary['n_unique_targets']} unique target labels, "
        f"with an overall success rate of {summary['success_rate_pct']}%. "
        f"Zero-peer runs accounted for {summary['pct_runs_with_zero_peers']}% of runs. "
        f"The median peer count was {summary['median_peer_count']}, and the mean peer count was {summary['mean_peer_count']}.\n"
    )
    lines.append("## Baseline-level behavior\n")
    for _, row in baseline_df.iterrows():
        lines.append(
            f"- {row['baseline_type']}: {int(row['runs'])} runs; success rate {row['success_rate_pct']}%; "
            f"zero-peer rate {row['zero_peer_rate_pct']}%; median peer count {round(row['median_peer_count'], 2)}; "
            f"median critical gaps {round(row['median_critical'], 2)}; median regulatory discrepancies {round(row['median_regulatory'], 2)}."
        )
    lines.append("")
    lines.append("## Label-format observations\n")
    lines.append(
        "Label-format summaries can be used to assess whether PLR, non-PLR, and OTC labels exhibit different discrepancy burdens or peer-availability profiles. "
        "These summaries should be interpreted as behavioral observations rather than direct evidence of true regulatory differences.\n"
    )
    if not format_df.empty:
        top_fmt = format_df.sort_values("runs", ascending=False).head(6)
        for _, row in top_fmt.iterrows():
            lines.append(
                f"- {row['baseline_type']} / {row['label_format']}: {int(row['runs'])} runs; median peer count {round(row['median_peer_count'], 2)}; "
                f"median critical gaps {round(row['median_critical'], 2)}; median regulatory discrepancies {round(row['median_regulatory'], 2)}."
            )
    lines.append("")
    lines.append("## Anomaly distribution\n")
    tier_counts = anomaly_summary.get("tier_counts", {})
    if tier_counts:
        tier_text = ", ".join([f"{k}: {v}" for k, v in sorted(tier_counts.items())])
        lines.append(f"A total of {anomaly_summary['n_anomalies']} anomaly rows were generated. Tier counts were: {tier_text}.\n")
    lines.append("## Candidate case studies\n")
    lines.append(
        "Candidate case studies should be selected from high-ranking outliers with non-trivial peer counts, preferably where the same target remains notable across more than one analytical view.\n"
    )
    if not top_critical.empty:
        lines.append("### Top runs by critical gaps\n")
        for _, row in top_critical.head(10).iterrows():
            lines.append(
                f"- {row['target_set_id']} ({row['baseline_type']}, peers={int(row['peer_count'])}, label_format={row['label_format']}): "
                f"critical={int(row['critical_gap_count'])}, regulatory={int(row['regulatory_discrepancy_count'])}, minor={int(row['minor_discrepancy_count'])}."
            )
    if not top_reg.empty:
        lines.append("\n### Top runs by regulatory discrepancies\n")
        for _, row in top_reg.head(10).iterrows():
            lines.append(
                f"- {row['target_set_id']} ({row['baseline_type']}, peers={int(row['peer_count'])}, label_format={row['label_format']}): "
                f"critical={int(row['critical_gap_count'])}, regulatory={int(row['regulatory_discrepancy_count'])}, minor={int(row['minor_discrepancy_count'])}."
            )
    lines.append("\n## Interpretation limits\n")
    lines.append(
        "These outputs do not establish that any individual flagged term represents a true or actionable safety signal. "
        "Instead, they provide a structured basis for describing system behavior, ranking outliers, and selecting a small number of interpretable case studies for qualitative explanation.\n"
    )
    return "\n".join(lines)


def main():
    folder_name = 'deepdive_20260409T211053Z'
    parser = argparse.ArgumentParser(description="Analyze Deep Dive batch output tables")
    parser.add_argument("--results", default="deepdive_outputs/"+folder_name+"/deepdive_batch_results.csv")
    parser.add_argument("--anomalies", default="deepdive_outputs/"+folder_name+"/deepdive_anomalies.csv")
    parser.add_argument("--output-dir", default="deepdive_outputs/post_analysis/"+folder_name)
    args = parser.parse_args()

    outdir = Path(args.output_dir)
    outdir.mkdir(parents=True, exist_ok=True)

    results = pd.read_csv(args.results)
    anomalies = pd.read_csv(args.anomalies)

    summary = summarize_results(results)
    anomaly_summary = summarize_anomalies(anomalies)
    overall_df = make_overall_summary(results)
    baseline_df = make_baseline_summary(results)
    format_df = make_label_format_summary(results)
    peer_count_df = make_peer_count_summary(results)
    soc_df = make_soc_summary(anomalies)
    top_critical_df = prepare_top_targets(results, "critical_gap_count", top_n=50)
    top_reg_df = prepare_top_targets(results, "regulatory_discrepancy_count", top_n=50)
    case_df = make_case_candidates(results, anomalies, top_n=50)

    (outdir / "analysis_summary.json").write_text(json.dumps({
        "results_summary": summary,
        "anomaly_summary": anomaly_summary,
    }, indent=2), encoding="utf-8")
    overall_df.to_csv(outdir / "overall_summary.csv", index=False)
    baseline_df.to_csv(outdir / "baseline_summary.csv", index=False)
    format_df.to_csv(outdir / "label_format_summary.csv", index=False)
    peer_count_df.to_csv(outdir / "peer_count_summary.csv", index=False)
    soc_df.to_csv(outdir / "soc_summary.csv", index=False)
    top_critical_df.to_csv(outdir / "top_targets_by_critical.csv", index=False)
    top_reg_df.to_csv(outdir / "top_targets_by_regulatory.csv", index=False)
    case_df.to_csv(outdir / "case_candidates.csv", index=False)

    manuscript = build_manuscript_text(summary, anomaly_summary, baseline_df, format_df, top_critical_df, top_reg_df)
    (outdir / "manuscript_results.md").write_text(manuscript, encoding="utf-8")

    print(f"Wrote analysis outputs to {outdir}")


if __name__ == "__main__":
    main()
