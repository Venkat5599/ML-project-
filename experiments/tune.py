"""Phase 5: Optuna hyperparameter tuning on the validation slice.

Objective: maximize average precision (PR-AUC) - the right objective for
heavy class imbalance and ranked alerts.

Run: python -m experiments.tune [--trials N]
"""
from __future__ import annotations

import argparse

import numpy as np
import optuna
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import LinearSVC, SVC
from sklearn.metrics import average_precision_score
from xgboost import XGBClassifier

from chainsleuth.config import SEED
from chainsleuth.data import load_dataset
from chainsleuth.experiments import save_metrics
from chainsleuth.metrics import evaluate_scores, timed_score
from chainsleuth.splits import feature_cols, temporal_split, xy

optuna.logging.set_verbosity(optuna.logging.WARNING)

RBF_SUBSAMPLE = 20_000  # kernel SVM is O(n^2); subsample licit rows for tuning


def _evaluate(model, X_val, y_val) -> tuple[dict, float]:
    if hasattr(model, "predict_proba"):
        scorer = lambda X: model.predict_proba(X)[:, 1]
    else:
        df_val = model.decision_function(X_val)
        lo, rng = df_val.min(), max(df_val.max() - df_val.min(), 1e-12)
        scorer = lambda X: (model.decision_function(X) - lo) / rng
    scores, elapsed = timed_score(scorer, X_val)
    return evaluate_scores(y_val, scores), elapsed


def tune_rf(trial, X_train, y_train):
    m = RandomForestClassifier(
        n_estimators=trial.suggest_int("n_estimators", 100, 500),
        max_depth=trial.suggest_int("max_depth", 4, 30),
        min_samples_leaf=trial.suggest_int("min_samples_leaf", 1, 20),
        max_features=trial.suggest_float("max_features", 0.1, 1.0),
        class_weight=trial.suggest_categorical("class_weight", ["balanced", "balanced_subsample"]),
        n_jobs=-1, random_state=SEED,
    )
    m.fit(X_train, y_train)
    return m


def tune_xgb(trial, X_train, y_train, pos_weight):
    m = XGBClassifier(
        n_estimators=trial.suggest_int("n_estimators", 100, 800),
        max_depth=trial.suggest_int("max_depth", 3, 10),
        learning_rate=trial.suggest_float("learning_rate", 0.01, 0.3, log=True),
        subsample=trial.suggest_float("subsample", 0.5, 1.0),
        colsample_bytree=trial.suggest_float("colsample_bytree", 0.4, 1.0),
        scale_pos_weight=trial.suggest_float("scale_pos_weight", pos_weight / 4, pos_weight * 4, log=True),
        min_child_weight=trial.suggest_float("min_child_weight", 0.1, 10, log=True),
        reg_lambda=trial.suggest_float("reg_lambda", 1e-3, 10, log=True),
        tree_method="hist", eval_metric="aucpr", random_state=SEED, n_jobs=-1,
    )
    m.fit(X_train, y_train)
    return m


def tune_lr(trial, X_train, y_train):
    m = make_pipeline(
        StandardScaler(),
        LogisticRegression(
            C=trial.suggest_float("C", 1e-3, 10, log=True),
            class_weight="balanced", max_iter=1500, random_state=SEED,
        ),
    )
    m.fit(X_train, y_train)
    return m


def tune_svm(trial, X_train, y_train):
    kernel = trial.suggest_categorical("kernel", ["linear", "rbf"])
    if kernel == "linear":
        m = make_pipeline(
            StandardScaler(),
            LinearSVC(C=trial.suggest_float("C", 1e-3, 10, log=True),
                      class_weight="balanced", max_iter=8000, random_state=SEED),
        )
        m.fit(X_train, y_train)
    else:
        idx = np.random.default_rng(SEED).choice(len(X_train), min(RBF_SUBSAMPLE, len(X_train)), replace=False)
        m = make_pipeline(
            StandardScaler(),
            SVC(C=trial.suggest_float("C", 1e-2, 100, log=True),
                gamma=trial.suggest_float("gamma", 1e-4, 1, log=True),
                class_weight="balanced", cache_size=1000, random_state=SEED),
        )
        m.fit(X_train[idx], y_train[idx])
    return m


def run_study(name: str, objective, n_trials: int) -> optuna.Study:
    study = optuna.create_study(direction="maximize", study_name=name,
                                sampler=optuna.samplers.TPESampler(seed=SEED))
    study.optimize(objective, n_trials=n_trials, show_progress_bar=False)
    print(f"  best AP={study.best_value:.4f}  params={study.best_params}")
    return study


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--trials", type=int, default=30)
    args = parser.parse_args()

    df = load_dataset()
    cols = feature_cols(df)
    train, val, _ = temporal_split(df)
    X_train, y_train = xy(train, cols)
    X_val, y_val = xy(val, cols)
    pos_weight = float((y_train == 0).sum() / (y_train == 1).sum())

    def ap_of(model) -> float:
        if hasattr(model, "predict_proba"):
            return float(average_precision_score(y_val, model.predict_proba(X_val)[:, 1]))
        return float(average_precision_score(y_val, model.decision_function(X_val)))

    specs = {
        "tuned_random_forest": (lambda t: tune_rf(t, X_train, y_train), "tabular"),
        "tuned_xgboost": (lambda t: tune_xgb(t, X_train, y_train, pos_weight), "tabular"),
        "tuned_logistic_regression": (lambda t: tune_lr(t, X_train, y_train), "tabular"),
        "tuned_svm": (lambda t: tune_svm(t, X_train, y_train), "tabular"),
    }

    for name, (build, family) in specs.items():
        print(f"[{name}] ({args.trials} trials)")
        study = run_study(name, lambda t: ap_of(build(t)), args.trials)
        best = build(optuna.trial.FixedTrial(study.best_params))
        metrics, elapsed = _evaluate(best, X_val, y_val)
        metrics["inference_sec"] = round(elapsed, 3)
        save_metrics(name, {"model": name, "family": family, "split": "temporal",
                            "val": metrics, "params": study.best_params,
                            "n_trials": args.trials})


if __name__ == "__main__":
    main()
