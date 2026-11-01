"""Phase 9: hybrid ensemble - combining supervised, anomaly and graph scores.

Protocol (leakage-safe):
  1. Fit every component on TRAIN only (steps 1-29) -> validation scores (30-34).
  2. Tune ensemble weights / stacking meta-model on those val scores.
  3. Refit components on TRAIN+VAL (1-34) -> test scores (35-49).
  4. Apply frozen ensemble weights, evaluate once on test.
  5. Calibrate the winning score with isotonic regression fit on val scores.

Ablations reported: xgboost | xgb+graph-features | xgb+gnn blend | full ensemble.
Scores for ALL test-window transactions are saved to
data/processed/test_scores.parquet for the dashboard.

Run: python -m experiments.hybrid
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
import torch
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss
from sklearn.preprocessing import MinMaxScaler, StandardScaler
from xgboost import XGBClassifier

from chainsleuth.config import (DATA_PROCESSED, FIGURES_DIR, METRICS_DIR,
                                MODELS_DIR, SEED, TEST_STEPS)
from chainsleuth.data import load_dataset
from chainsleuth.experiments import save_metrics
from chainsleuth.graph import load_graph
from chainsleuth.metrics import evaluate_scores
from chainsleuth.splits import feature_cols, temporal_split, xy
from experiments.graph_models import gnn_scores, train_gnn
from experiments.graph_features import GRAPH_COLS, GRAPH_FEATURE_PATH

warnings.filterwarnings("ignore")
GNN_EPOCHS, GNN_PATIENCE = 120, 15
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"


def load_params(name: str) -> dict:
    return json.loads((METRICS_DIR / f"{name}.json").read_text())["params"]


# ---------------------------------------------------------------- components
def fit_xgb(X, y):
    m = XGBClassifier(**load_params("tuned_xgboost"), tree_method="hist",
                      device="cuda", eval_metric="aucpr", random_state=SEED, n_jobs=-1)
    m.fit(X, y)
    return m, lambda X_: m.predict_proba(X_)[:, 1]


def fit_xgb_graph(X, y):
    m = XGBClassifier(**load_params("tuned_xgboost"), tree_method="hist",
                      device="cuda", eval_metric="aucpr", random_state=SEED, n_jobs=-1)
    m.fit(X, y)
    return m, lambda X_: m.predict_proba(X_)[:, 1]


def fit_rf(X, y):
    m = RandomForestClassifier(**load_params("tuned_random_forest"),
                               n_jobs=-1, random_state=SEED)
    m.fit(X, y)
    return m, lambda X_: m.predict_proba(X_)[:, 1]


def fit_iso(X_licit):
    m = IsolationForest(n_estimators=300, contamination="auto",
                        n_jobs=-1, random_state=SEED)
    m.fit(X_licit)
    return m, lambda X_: -m.decision_function(X_)


def fit_ae(X_licit):
    """Trains the autoencoder; returns (model, scorer) like the others."""
    import torch.nn as nn
    torch.manual_seed(SEED)
    scaler = StandardScaler().fit(X_licit)
    Xl = torch.tensor(scaler.transform(X_licit), dtype=torch.float32).to(DEVICE)
    d = Xl.shape[1]
    ae = nn.Sequential(nn.Linear(d, 96), nn.ReLU(), nn.Linear(96, 48), nn.ReLU(),
                       nn.Linear(48, 24), nn.ReLU(), nn.Linear(24, 48), nn.ReLU(),
                       nn.Linear(48, 96), nn.ReLU(), nn.Linear(96, d)).to(DEVICE)
    opt = torch.optim.Adam(ae.parameters(), lr=1e-3)
    loss_fn = nn.MSELoss()
    for _ in range(30):
        perm = torch.randperm(len(Xl), device=DEVICE)
        for i in range(0, len(Xl), 1024):
            b = Xl[perm[i:i + 1024]]
            opt.zero_grad(); loss_fn(ae(b), b).backward(); opt.step()
    ae.eval()

    def scorer(X_):
        with torch.no_grad():
            Xs = torch.tensor(scaler.transform(X_), dtype=torch.float32).to(DEVICE)
            return ((ae(Xs) - Xs) ** 2).mean(dim=1).cpu().numpy()
    return ae, scorer


def fit_gnn(data, mask, eval_mask, y_eval):
    model, _ = train_gnn(data, mask, eval_mask, y_eval, GNN_EPOCHS,
                         hidden=256, lr=0.005, dropout=0.3,
                         patience=GNN_PATIENCE, device=DEVICE, verbose=False)
    return model


# ------------------------------------------------------------------- helpers
def simplex_weights(study_trial, names):
    ws = np.array([study_trial.suggest_float(f"w_{n}", 0.0, 1.0) for n in names])
    return ws / max(ws.sum(), 1e-9)


def blend(weights, scores_dict):
    return sum(weights[n] * s for n, s in scores_dict.items())


def main() -> None:
    import optuna
    optuna.logging.set_verbosity(optuna.logging.WARNING)

    df = load_dataset()
    gfeats = pd.read_parquet(GRAPH_FEATURE_PATH)
    df = df.merge(gfeats, on="tx_id", how="left")
    train, val, test = temporal_split(df)
    fit = pd.concat([train, val])

    base = feature_cols(df)
    gcols = base + GRAPH_COLS
    X_tr, y_tr = xy(train, base); X_v, y_v = xy(val, base)
    X_f, y_f = xy(fit, base); X_t, y_t = xy(test, base)
    Xg_tr, _ = xy(train, gcols); Xg_v, _ = xy(val, gcols)
    Xg_f, _ = xy(fit, gcols); Xg_t, _ = xy(test, gcols)
    Xl_tr, _ = xy(train[train["label"] == 0], base)
    Xl_f, _ = xy(fit[fit["label"] == 0], base)

    data = load_graph()

    # ================= stage 1: train-only fits -> val scores ================
    print("[stage 1] fitting components on train (steps 1-29)")
    comps_val, comps_test = {}, {}

    _, s = fit_xgb(X_tr, y_tr); comps_val["xgb"] = s(X_v)
    _, s = fit_xgb_graph(Xg_tr, y_tr); comps_val["xgb_graph"] = s(Xg_v)
    _, s = fit_rf(X_tr, y_tr); comps_val["rf"] = s(X_v)
    _, s = fit_iso(Xl_tr); comps_val["iso"] = s(X_v)
    _, s = fit_ae(Xl_tr); comps_val["ae"] = s(X_v)

    gnn_v = fit_gnn(data, data.train_mask, data.val_mask, y_v)
    comps_val["gnn"] = gnn_scores(gnn_v, data.to(DEVICE), DEVICE)[data.val_mask.cpu().numpy()]

    # ================= stage 2: tune ensemble on val ==========================
    print("[stage 2] tuning ensemble weights on val")
    norm = {k: MinMaxScaler().fit(s.reshape(-1, 1)).transform(s.reshape(-1, 1)).ravel()
            for k, s in comps_val.items()}
    names = ["xgb", "rf", "gnn", "iso", "ae"]

    def obj(trial):
        w = simplex_weights(trial, names)
        return average_precision_score(y_v, blend(dict(zip(names, w)),
                                                  {k: norm[k] for k in names}))

    study = optuna.create_study(direction="maximize",
                                sampler=optuna.samplers.TPESampler(seed=SEED))
    study.optimize(obj, n_trials=60)
    w = simplex_weights(optuna.trial.FixedTrial(study.best_params), names)
    weights = dict(zip(names, w))
    print(f"  weights={ {k: round(v, 3) for k, v in weights.items()} }  val AP={study.best_value:.4f}")

    # stacking alternative: logistic meta-model on val scores
    stack_X = np.column_stack([norm[k] for k in names])
    meta = LogisticRegression(class_weight="balanced", random_state=SEED).fit(stack_X, y_v)
    stack_val = meta.predict_proba(stack_X)[:, 1]
    print(f"  stacking val AP={average_precision_score(y_v, stack_val):.4f}")

    # ================= stage 3: refit on train+val -> test scores =============
    print("[stage 3] refitting on train+val, scoring test")
    scorers = {}
    _, scorers["xgb"] = fit_xgb(X_f, y_f); comps_test["xgb"] = scorers["xgb"](X_t)
    _, s = fit_xgb_graph(Xg_f, y_f); comps_test["xgb_graph"] = s(Xg_t)
    _, scorers["rf"] = fit_rf(X_f, y_f); comps_test["rf"] = scorers["rf"](X_t)
    _, scorers["iso"] = fit_iso(Xl_f); comps_test["iso"] = scorers["iso"](X_t)
    _, scorers["ae"] = fit_ae(Xl_f); comps_test["ae"] = scorers["ae"](X_t)

    fit_mask = data.train_mask | data.val_mask
    gnn_t = fit_gnn(data, fit_mask, data.test_mask, y_t)
    all_gnn = gnn_scores(gnn_t, data.to(DEVICE), DEVICE)
    comps_test["gnn"] = all_gnn[data.test_mask.cpu().numpy()]

    # normalize test scores with the val-fit scalers for consistency;
    # clip to [0,1] - out-of-range anomaly scores saturate rather than explode
    norm_test = {k: np.clip(
        MinMaxScaler().fit(comps_val[k].reshape(-1, 1))
        .transform(comps_test[k].reshape(-1, 1)).ravel(), 0, 1) for k in names}

    # ================= stage 4: evaluate ablations on test ====================
    print("[stage 4] test evaluation")
    table = []

    def report(name, scores, family="ensemble"):
        m = evaluate_scores(y_t, scores)
        save_metrics(f"final_{name}", {"model": name, "family": family,
                                       "split": "temporal", "test": m})
        table.append({"model": name, "family": family, **m})
        print(f"  {name:26s} AP={m['avg_precision']:.3f} P@100={m['precision@100']:.3f} "
              f"R@100={m['recall@100']:.3f} F1={m['f1']:.3f}")
        return m

    report("xgb", comps_test["xgb"], family="tabular")
    report("xgb_graph_features", comps_test["xgb_graph"], family="experiment")
    report("graphsage", comps_test["gnn"], family="graph")
    report("xgb_gnn_blend", 0.5 * norm_test["xgb"] + 0.5 * norm_test["gnn"],
           family="ensemble")
    report("ensemble_weighted", blend(weights, norm_test))
    report("ensemble_stacked",
           meta.predict_proba(np.column_stack([norm_test[k] for k in names]))[:, 1])

    # ================= stage 5: calibration ==================================
    print("[stage 5] isotonic calibration of weighted ensemble")
    val_ens = blend(weights, {k: norm[k] for k in names})
    test_ens = blend(weights, norm_test)
    iso = IsotonicRegression(out_of_bounds="clip").fit(val_ens, y_v)
    cal = iso.predict(test_ens)
    report("ensemble_calibrated", cal)

    fig, ax = plt.subplots(figsize=(6, 6))
    for scores, label in [(test_ens, "uncalibrated"), (cal, "isotonic")]:
        from sklearn.calibration import calibration_curve
        frac, mean = calibration_curve(y_t, scores, n_bins=10, strategy="quantile")
        ax.plot(mean, frac, "o-", label=f"{label} (brier={brier_score_loss(y_t, scores):.3f})")
    ax.plot([0, 1], [0, 1], "k--", alpha=0.5)
    ax.set_xlabel("mean predicted score"); ax.set_ylabel("observed illicit fraction")
    ax.set_title("Calibration - weighted ensemble (test window)")
    ax.legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "calibration_curve.png")
    plt.close(fig)

    # ================= scores parquet for the dashboard =======================
    test_window = df["time_step"].isin(TEST_STEPS)
    tx2gnn = dict(zip(data.tx_id.cpu().numpy(), all_gnn))
    # per-tx test scores are aligned to `test` df row order
    test_scores = test[["tx_id", "time_step", "label"]].copy()
    for k in ["xgb", "rf", "iso", "ae", "gnn"]:
        test_scores[f"score_{k}"] = comps_test[k]
    test_scores["score_xgb_graph"] = comps_test["xgb_graph"]
    test_scores["score_hybrid"] = test_ens
    test_scores["score_hybrid_calibrated"] = cal

    # UNKNOWN-labeled test txs through the SAME pipeline (components -> val
    # scalers -> tuned weights -> isotonic calibration)
    unk = df[test_window & (df["label"] < 0)]
    unknown = unk[["tx_id", "time_step", "label"]].copy()
    Xu, _ = xy(unk, base)
    unknown["score_xgb"] = scorers["xgb"](Xu)
    unknown["score_rf"] = scorers["rf"](Xu)
    unknown["score_iso"] = scorers["iso"](Xu)
    unknown["score_ae"] = scorers["ae"](Xu)
    unknown["score_gnn"] = unknown["tx_id"].map(tx2gnn)
    unk_norm = {k: np.clip(
        MinMaxScaler().fit(comps_val[k].reshape(-1, 1))
        .transform(unknown[f"score_{k}"].to_numpy().reshape(-1, 1)).ravel(), 0, 1)
        for k in names}
    unknown["score_hybrid"] = blend(weights, unk_norm)
    unknown["score_hybrid_calibrated"] = iso.predict(unknown["score_hybrid"])

    out = pd.concat([test_scores, unknown]).sort_values("score_hybrid", ascending=False)
    out.to_parquet(DATA_PROCESSED / "test_scores.parquet")
    print(f"saved scores for {len(out):,} test-window txs -> test_scores.parquet")

    pd.DataFrame(table).to_csv(METRICS_DIR / "ensemble_comparison.csv", index=False)


if __name__ == "__main__":
    main()
