"""Phase 6: final evaluation on the held-out test window (time steps 35-49).

Protocol: every final model is retrained on train+val (steps 1-34), using tuned
hyperparameters where a tuned_* metrics file exists, then evaluated ONCE on the
test window. Also runs the comparison experiments:
  - default vs tuned (test window)
  - random split vs temporal split (XGBoost)
  - full features vs top-30 reduced features (XGBoost)
  - SHAP explanations for the best tabular model

Run: python -m experiments.evaluate
"""
from __future__ import annotations

import json
import warnings

import joblib
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import precision_recall_curve
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import LinearSVC, SVC
from sklearn.tree import DecisionTreeClassifier
from xgboost import XGBClassifier

from chainsleuth.config import FIGURES_DIR, METRICS_DIR, MODELS_DIR, SEED
from chainsleuth.data import load_dataset
from chainsleuth.experiments import save_metrics
from chainsleuth.metrics import evaluate_scores, timed_score
from chainsleuth.splits import feature_cols, random_split, temporal_split, xy
from experiments.anomaly import run_autoencoder, run_isolation_forest

warnings.filterwarnings("ignore", category=UserWarning)


def load_tuned(name: str) -> dict | None:
    path = METRICS_DIR / f"{name}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text()).get("params")


def scorer_for(model):
    if hasattr(model, "predict_proba"):
        return lambda X: model.predict_proba(X)[:, 1]
    return lambda X: model.decision_function(X)


def build_supervised(params: dict | None, kind: str, pos_weight: float):
    p = dict(params or {})
    if kind == "lr":
        return make_pipeline(StandardScaler(), LogisticRegression(
            class_weight="balanced", max_iter=1500, random_state=SEED, **p))
    if kind == "dt":
        return DecisionTreeClassifier(class_weight="balanced", random_state=SEED)
    if kind == "rf":
        return RandomForestClassifier(n_jobs=-1, random_state=SEED, **p)
    if kind == "xgb":
        return XGBClassifier(tree_method="hist", device="cuda", eval_metric="aucpr",
                             random_state=SEED, n_jobs=-1, **p)
    if kind == "svm":
        kernel = p.pop("kernel", "linear")
        if kernel == "rbf":
            return make_pipeline(StandardScaler(), SVC(
                class_weight="balanced", cache_size=1000, random_state=SEED, **p))
        return make_pipeline(StandardScaler(), LinearSVC(
            class_weight="balanced", max_iter=8000, random_state=SEED, **p))
    raise ValueError(kind)


def run_model(name, family, model, X_fit, y_fit, X_test, y_test,
              subsample: int | None = None) -> dict:
    if subsample:
        rng = np.random.default_rng(SEED)
        idx = rng.choice(len(X_fit), min(subsample, len(X_fit)), replace=False)
        X_fit, y_fit = X_fit[idx], y_fit[idx]
    model.fit(X_fit, y_fit)
    scores, elapsed = timed_score(scorer_for(model), X_test)
    metrics = evaluate_scores(y_test, scores)
    metrics["inference_sec"] = round(elapsed, 3)
    save_metrics(f"final_{name}", {"model": name, "family": family,
                                   "split": "temporal", "test": metrics})
    return metrics, scores, model


def pr_curves(results: dict[str, np.ndarray], y_test: np.ndarray) -> None:
    fig, ax = plt.subplots(figsize=(8, 6))
    base = y_test.mean()
    for name, scores in results.items():
        prec, rec, _ = precision_recall_curve(y_test, scores)
        ax.plot(rec, prec, label=name, lw=1.4)
    ax.axhline(base, ls="--", c="gray", label=f"prevalence={base:.3f}")
    ax.set_xlabel("recall"); ax.set_ylabel("precision")
    ax.set_title("Precision-recall curves - test window (time steps 35-49)")
    ax.legend(fontsize=8); ax.set_xlim(0, 1); ax.set_ylim(0, 1)
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "pr_curves_test.png")
    plt.close(fig)


def shap_summary(xgb_model, X_test: np.ndarray, cols: list[str]) -> None:
    import shap

    rng = np.random.default_rng(SEED)
    Xs = X_test[rng.choice(len(X_test), min(5000, len(X_test)), replace=False)]
    explainer = shap.TreeExplainer(xgb_model)
    shap_values = explainer.shap_values(Xs)
    plt.figure(figsize=(9, 7))
    shap.summary_plot(shap_values, pd.DataFrame(Xs, columns=cols), show=False, max_display=20)
    plt.tight_layout()
    plt.savefig(FIGURES_DIR / "shap_summary_xgb.png", dpi=130, bbox_inches="tight")
    plt.close("all")


def main() -> None:
    df = load_dataset()
    cols = feature_cols(df)
    train, val, test = temporal_split(df)
    fit_df = pd.concat([train, val])
    X_fit, y_fit = xy(fit_df, cols)
    X_test, y_test = xy(test, cols)
    pos_weight = float((y_fit == 0).sum() / (y_fit == 1).sum())
    print(f"fit {len(y_fit):,} labeled ({y_fit.sum():,} illicit) | "
          f"test {len(y_test):,} ({y_test.sum():,} illicit)")

    results, table = {}, []

    specs = [
        ("logistic_regression", "lr", "tuned_logistic_regression", None),
        ("decision_tree", "dt", None, None),
        ("random_forest", "rf", "tuned_random_forest", None),
        ("xgboost", "xgb", "tuned_xgboost", None),
        ("svm", "svm", "tuned_svm", 20_000),
    ]
    best_xgb, xgb_scores = None, None
    for name, kind, tuned_name, subsample in specs:
        params = load_tuned(tuned_name) if tuned_name else None
        if params is None and kind == "xgb":
            params = {"n_estimators": 300, "max_depth": 6, "learning_rate": 0.1,
                      "subsample": 0.8, "colsample_bytree": 0.8,
                      "scale_pos_weight": pos_weight}
        if params is None and kind == "rf":
            params = {"n_estimators": 200, "class_weight": "balanced_subsample"}
        if params is None and kind == "lr":
            params = {}
        if params is None and kind == "svm":
            params = {"kernel": "linear"}
        model = build_supervised(params, kind, pos_weight)
        print(f"[{name}] params={params}")
        metrics, scores, fitted = run_model(name, "tabular", model, X_fit, y_fit,
                                            X_test, y_test, subsample=subsample)
        results[name] = scores
        joblib.dump(fitted, MODELS_DIR / f"{name}.joblib")
        if kind == "xgb":
            best_xgb, xgb_scores = fitted, scores
        table.append({"model": name, "family": "tabular", **metrics})

    # --- anomaly detectors on licit-only train+val ---------------------------
    X_licit, _ = xy(fit_df[fit_df["label"] == 0], cols)
    for name, fn in [("isolation_forest", run_isolation_forest),
                     ("autoencoder", run_autoencoder)]:
        print(f"[{name}]")
        metrics, scores = fn(X_licit, X_test, y_test)
        save_metrics(f"final_{name}", {"model": name, "family": "anomaly",
                                       "split": "temporal", "test": metrics})
        table.append({"model": name, "family": "anomaly", **metrics})
        results[name] = scores

    # --- experiment 1: random split vs temporal split (XGBoost) --------------
    print("[experiment] random vs temporal split (xgboost)")
    r_train, r_val, r_test = random_split(df)
    Xr_fit, yr_fit = xy(pd.concat([r_train, r_val]), cols)
    Xr_test, yr_test = xy(r_test, cols)
    xgb_r = XGBClassifier(**(load_tuned("tuned_xgboost") or
                             {"n_estimators": 300, "max_depth": 6, "learning_rate": 0.1,
                              "subsample": 0.8, "colsample_bytree": 0.8,
                              "scale_pos_weight": float((yr_fit == 0).sum() / max((yr_fit == 1).sum(), 1))}),
                          tree_method="hist", device="cuda", eval_metric="aucpr",
                          random_state=SEED, n_jobs=-1)
    xgb_r.fit(Xr_fit, yr_fit)
    rs = xgb_r.predict_proba(Xr_test)[:, 1]
    m = evaluate_scores(yr_test, rs)
    save_metrics("experiment_random_split_xgboost",
                 {"model": "xgboost", "family": "tabular", "split": "random",
                  "test": m, "note": "optimistic baseline - leaks temporally"})
    table.append({"model": "xgboost_random_split", "family": "experiment", **m})

    # --- experiment 2: full features vs top-30 reduced (XGBoost) -------------
    print("[experiment] full vs top-30 features (xgboost)")
    imp = pd.Series(best_xgb.feature_importances_, index=cols).sort_values(ascending=False)
    top30 = imp.head(30).index.tolist()
    X30_fit, _ = xy(fit_df, top30)
    X30_test, _ = xy(test, top30)
    xgb30 = XGBClassifier(**(load_tuned("tuned_xgboost") or {}), tree_method="hist",
                          device="cuda", eval_metric="aucpr", random_state=SEED, n_jobs=-1)
    xgb30.fit(X30_fit, y_fit)
    s30 = xgb30.predict_proba(X30_test)[:, 1]
    m = evaluate_scores(y_test, s30)
    save_metrics("experiment_top30_features_xgboost",
                 {"model": "xgboost_top30", "family": "experiment", "split": "temporal",
                  "test": m, "features": top30})
    table.append({"model": "xgboost_top30_features", "family": "experiment", **m})

    # --- SHAP on the best tabular model --------------------------------------
    print("[shap] xgboost summary plot")
    shap_summary(best_xgb, X_test, cols)

    # --- comparison table -----------------------------------------------------
    results["xgboost"] = xgb_scores
    pr_curves(results, y_test)
    comparison = pd.DataFrame(table)
    comparison.to_csv(METRICS_DIR / "comparison.csv", index=False)
    show = comparison[["model", "precision", "recall", "f1", "avg_precision",
                       "roc_auc", "precision@100", "recall@100", "inference_sec"]]
    print("\n=== FINAL TEST RESULTS (time steps 35-49) ===")
    print(show.round(3).to_string(index=False))

    md = "| model | family | P | R | F1 | AP | ROC-AUC | P@100 | R@100 | time(s) |\n|---|---|---|---|---|---|---|---|---|---|\n"
    for r in table:
        t = r.get("inference_sec", float("nan"))
        md += (f"| {r['model']} | {r['family']} | {r['precision']:.3f} | {r['recall']:.3f} "
               f"| {r['f1']:.3f} | {r['avg_precision']:.3f} | {r['roc_auc']:.3f} "
               f"| {r['precision@100']:.3f} | {r['recall@100']:.3f} | {t:.3f} |\n")
    (METRICS_DIR / "comparison.md").write_text(md)
    print(f"\ncomparison -> {METRICS_DIR / 'comparison.csv'}")


if __name__ == "__main__":
    main()
