"""Render the results tables of report/REPORT.md from results/metrics.

Every table in section 5 sits between marker comments, for example

    <!-- metrics:final -->
    | model | ... |
    <!-- /metrics:final -->

`python -m experiments.report_tables` rewrites the text between the markers
from the metric JSON files. `--check` exits non-zero when the report is out of
date, which tests/test_report_tables.py runs, so a stale table fails the tests.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from chainsleuth.config import METRICS_DIR, REPORT_DIR

REPORT = REPORT_DIR / "REPORT.md"

BASELINES = [
    ("logistic regression", "baseline_logistic_regression"),
    ("decision tree", "baseline_decision_tree"),
    ("random forest", "baseline_random_forest"),
    ("xgboost", "baseline_xgboost"),
    ("linear SVM", "baseline_linear_svm"),
    ("isolation forest (anomaly)", "anomaly_isolation_forest"),
    ("autoencoder (anomaly)", "anomaly_autoencoder"),
]

# (row label, tuned file, baseline file it improves on, note on the search)
TUNED = [
    ("logistic regression", "tuned_logistic_regression", "baseline_logistic_regression", ""),
    ("random forest", "tuned_random_forest", "baseline_random_forest", ""),
    ("xgboost", "tuned_xgboost", "baseline_xgboost", ""),
    ("SVM", "tuned_svm", "baseline_linear_svm", "RBF on 10k subsample"),
]

FINAL = [
    ("xgboost", "final_xgboost"),
    ("random forest", "final_random_forest"),
    ("SVM (rbf)", "final_svm"),
    ("logistic regression", "final_logistic_regression"),
    ("decision tree", "final_decision_tree"),
    ("isolation forest", "final_isolation_forest"),
    ("autoencoder", "final_autoencoder"),
    ("GraphSAGE", "final_graphsage"),
    ("xgb + graph features", "final_xgb_graph_features"),
    ("xgb + gnn blend", "final_xgb_gnn_blend"),
    ("ensemble (weighted)", "final_ensemble_weighted"),
    ("ensemble (stacked)", "final_ensemble_stacked"),
    ("ensemble (calibrated)", "final_ensemble_calibrated"),
]

WEIGHT_NAMES = {"xgb": "xgb", "rf": "rf", "ae": "ae", "gnn": "gnn", "iso": "iso"}


def load(stem: str, metrics_dir: Path = METRICS_DIR) -> dict:
    path = metrics_dir / f"{stem}.json"
    if not path.exists():
        raise FileNotFoundError(f"{path} missing - run the experiment that writes it")
    return json.loads(path.read_text())


def f3(x: float) -> str:
    return f"{x:.3f}"


def _fmt_param(k: str, v) -> str:
    if isinstance(v, float):
        return f"{k}={v:.3g}"
    return f"{k}={v}"


NOTABLE = {
    "tuned_logistic_regression": ["C"],
    "tuned_random_forest": ["n_estimators", "max_depth", "max_features"],
    "tuned_xgboost": ["n_estimators", "max_depth", "learning_rate", "scale_pos_weight"],
    "tuned_svm": ["kernel", "C", "gamma"],
}


def table_baselines(md: Path = METRICS_DIR) -> str:
    rows = ["| model | AP | F1 | P@100 |", "|---|---|---|---|"]
    for label, stem in BASELINES:
        v = load(stem, md)["val"]
        rows.append(f"| {label} | {f3(v['avg_precision'])} | {f3(v['f1'])} | {f3(v['precision@100'])} |")
    return "\n".join(rows)


def table_tuning(md: Path = METRICS_DIR) -> str:
    rows = ["| model | trials | best val AP | notable params |", "|---|---|---|---|"]
    for label, stem, base, note in TUNED:
        t, b = load(stem, md), load(base, md)
        trials = str(t.get("n_trials", "–")) + (f" ({note})" if note else "")
        params = ", ".join(_fmt_param(k, t["params"][k]) for k in NOTABLE[stem] if k in t["params"])
        rows.append(f"| {label} | {trials} | {f3(b['val']['avg_precision'])} → "
                    f"**{f3(t['val']['avg_precision'])}** | {params} |")
    return "\n".join(rows)


def table_final(md: Path = METRICS_DIR) -> str:
    data = [(label, load(stem, md)["test"]) for label, stem in FINAL]
    best_ap = max(t["avg_precision"] for _, t in data)
    best_f1 = max(t["f1"] for _, t in data)
    rows = ["| model | P | R | F1 | AP | ROC-AUC | P@100 | R@100 |", "|---|---|---|---|---|---|---|---|"]
    for label, t in data:
        ap, f1 = f3(t["avg_precision"]), f3(t["f1"])
        is_ap, is_f1 = t["avg_precision"] == best_ap, t["f1"] == best_f1
        name = f"**{label}**" if (is_ap or is_f1) else label
        rows.append(
            f"| {name} | {f3(t['precision'])} | {f3(t['recall'])} | {f'**{f1}**' if is_f1 else f1} | "
            f"{f'**{ap}**' if is_ap else ap} | {f3(t['roc_auc'])} | {f3(t['precision@100'])} | "
            f"{f3(t['recall@100'])} |")
    return "\n".join(rows)


def text_weights(md: Path = METRICS_DIR) -> str:
    w = load("final_ensemble_weighted", md).get("weights")
    if not w:
        return "Ensemble weights not recorded; re-run `python -m experiments.hybrid`."
    parts = ", ".join(f"{WEIGHT_NAMES.get(k, k)} {v:.2f}" for k, v in sorted(w.items(), key=lambda kv: -kv[1]))
    return f"Ensemble weights tuned on validation (Optuna, 5-model simplex): {parts}."


def table_ablations(md: Path = METRICS_DIR) -> str:
    T = lambda s: load(s, md)["test"]  # noqa: E731
    xgb, rnd, top = T("final_xgboost"), T("experiment_random_split_xgboost"), T("experiment_top30_features_xgboost")
    gf, gnn = T("final_xgb_graph_features"), T("final_graphsage")
    blend, ens = T("final_xgb_gnn_blend"), T("final_ensemble_weighted")
    pts = (rnd["avg_precision"] - xgb["avg_precision"]) * 100
    rows = [
        "| experiment | result | interpretation |",
        "|---|---|---|",
        f"| XGBoost, random split vs temporal split | AP {f3(rnd['avg_precision'])} vs {f3(xgb['avg_precision'])} | "
        f"random splitting inflates AP by {pts:.1f} points — temporal leakage optimism quantified |",
        f"| XGBoost, top-30 features vs all 165 | AP {f3(top['avg_precision'])} vs {f3(xgb['avg_precision'])} | "
        "most signal sits in ~30 features; slight loss at high compression |",
        f"| XGBoost + hand graph features | AP {f3(gf['avg_precision'])} vs {f3(xgb['avg_precision'])} | "
        "no meaningful gain — dataset's 72 aggregated features already encode one-hop structure |",
        f"| GraphSAGE alone | AP {f3(gnn['avg_precision'])}, P@100 {f3(gnn['precision@100'])} | "
        "weaker ranker than tuned XGBoost under temporal drift, but its top-100 stays almost pure — a complementary head-of-queue signal |",
        f"| Ensemble / blend vs best single model | F1 {f3(blend['f1'])}/{f3(ens['f1'])} vs {f3(xgb['f1'])}; "
        f"AP {f3(blend['avg_precision'])}/{f3(ens['avg_precision'])} vs {f3(xgb['avg_precision'])} | "
        "the two-model blend takes best F1; both keep top-K precision at 1.0 — robustness, not dominance |",
    ]
    return "\n".join(rows)


BLOCKS = {
    "baselines": table_baselines,
    "tuning": table_tuning,
    "final": table_final,
    "weights": text_weights,
    "ablations": table_ablations,
}


def sync(text: str, md: Path = METRICS_DIR) -> str:
    """Replace every marked block with its freshly rendered content."""
    for name, render in BLOCKS.items():
        pat = re.compile(rf"(<!-- metrics:{name} -->\n)(.*?)(\n<!-- /metrics:{name} -->)", re.S)
        if not pat.search(text):
            raise ValueError(f"REPORT.md has no <!-- metrics:{name} --> block")
        body = render(md)
        text = pat.sub(lambda m: m.group(1) + body + m.group(3), text)
    return text


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="fail if REPORT.md is stale")
    args = ap.parse_args(argv)
    current = REPORT.read_text()
    fresh = sync(current)
    if args.check:
        if fresh != current:
            print("report/REPORT.md tables are stale: run python -m experiments.report_tables")
            return 1
        print("report tables up to date")
        return 0
    REPORT.write_text(fresh)
    print(f"updated {REPORT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
