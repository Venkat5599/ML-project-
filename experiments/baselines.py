"""Phase 3: default-parameter baseline models, evaluated on the validation slice.

Protocol: train on time steps 1-29, evaluate on steps 30-34 (validation).
Test data (35-49) is reserved for the single final evaluation in evaluate.py.

Run: python -m experiments.baselines
"""
from __future__ import annotations

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import LinearSVC
from sklearn.tree import DecisionTreeClassifier
from sklearn.ensemble import RandomForestClassifier
from xgboost import XGBClassifier

from chainsleuth.config import SEED
from chainsleuth.data import load_dataset
from chainsleuth.experiments import normalize_scores, save_metrics
from chainsleuth.metrics import evaluate_scores, timed_score
from chainsleuth.splits import feature_cols, temporal_split, xy


def build_models(pos_weight: float) -> dict:
    """Default-ish configs; class imbalance handled the standard way per model."""
    return {
        "logistic_regression": (
            "tabular",
            make_pipeline(
                StandardScaler(),
                LogisticRegression(max_iter=1000, class_weight="balanced", random_state=SEED),
            ),
        ),
        "decision_tree": (
            "tabular",
            DecisionTreeClassifier(class_weight="balanced", random_state=SEED),
        ),
        "random_forest": (
            "tabular",
            RandomForestClassifier(
                n_estimators=200, class_weight="balanced_subsample",
                n_jobs=-1, random_state=SEED,
            ),
        ),
        "xgboost": (
            "tabular",
            XGBClassifier(
                n_estimators=300, max_depth=6, learning_rate=0.1,
                subsample=0.8, colsample_bytree=0.8, scale_pos_weight=pos_weight,
                tree_method="hist", device="cuda", eval_metric="aucpr",
                random_state=SEED, n_jobs=-1,
            ),
        ),
        "linear_svm": (
            "tabular",
            make_pipeline(
                StandardScaler(),
                LinearSVC(class_weight="balanced", random_state=SEED, max_iter=5000),
            ),
        ),
    }


def score_fn(model):
    """Return a callable X -> suspicion score in [0,1]-ish space."""
    if hasattr(model, "predict_proba"):
        return lambda X: model.predict_proba(X)[:, 1]
    return lambda X: normalize_scores(model.decision_function(X))


def main() -> None:
    df = load_dataset()
    cols = feature_cols(df)
    train, val, _ = temporal_split(df)
    X_train, y_train = xy(train, cols)
    X_val, y_val = xy(val, cols)
    pos_weight = float((y_train == 0).sum() / (y_train == 1).sum())
    print(f"train {len(y_train):,} labeled ({y_train.sum():,} illicit) | "
          f"val {len(y_val):,} ({y_val.sum():,} illicit) | pos_weight={pos_weight:.1f}")

    for name, (family, model) in build_models(pos_weight).items():
        model.fit(X_train, y_train)
        scores, elapsed = timed_score(score_fn(model), X_val)
        metrics = evaluate_scores(y_val, scores)
        metrics["inference_sec"] = round(elapsed, 3)
        save_metrics(
            f"baseline_{name}",
            {"model": name, "family": family, "split": "temporal",
             "val": metrics, "params": "defaults"},
        )
        print(f"{name:22s} AP={metrics['avg_precision']:.3f} "
              f"F1={metrics['f1']:.3f} P@100={metrics['precision@100']:.3f}")


if __name__ == "__main__":
    main()
