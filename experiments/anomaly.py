"""Phase 4: unsupervised anomaly detection - Isolation Forest + autoencoder.

Both are fit ONLY on licit-labelled training transactions (steps 1-29),
then scored on the validation slice. Higher score = more anomalous.

Run: python -m experiments.anomaly
"""
from __future__ import annotations

import joblib
import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

from chainsleuth.config import MODELS_DIR, SEED
from chainsleuth.data import load_dataset
from chainsleuth.experiments import save_metrics
from chainsleuth.metrics import evaluate_scores, timed_score
from chainsleuth.splits import feature_cols, temporal_split, xy


def run_isolation_forest(X_licit, X_eval, y_eval) -> tuple[dict, np.ndarray]:
    model = IsolationForest(
        n_estimators=300, max_samples="auto", contamination="auto",
        n_jobs=-1, random_state=SEED,
    )
    model.fit(X_licit)
    # higher decision_function = more normal -> negate so higher = suspicious
    scores, elapsed = timed_score(lambda X: -model.decision_function(X), X_eval)
    metrics = evaluate_scores(y_eval, scores)
    metrics["inference_sec"] = round(elapsed, 3)
    joblib.dump(model, MODELS_DIR / "isolation_forest.joblib")
    return metrics, scores


def run_autoencoder(X_licit, X_eval, y_eval) -> tuple[dict, np.ndarray]:
    """MLP autoencoder on scaled features; reconstruction error = anomaly score."""
    import torch
    import torch.nn as nn

    torch.manual_seed(SEED)
    device = "cuda" if torch.cuda.is_available() else "cpu"

    scaler = StandardScaler().fit(X_licit)
    Xl = torch.tensor(scaler.transform(X_licit), dtype=torch.float32)

    d = Xl.shape[1]
    model = nn.Sequential(
        nn.Linear(d, 96), nn.ReLU(),
        nn.Linear(96, 48), nn.ReLU(),
        nn.Linear(48, 24), nn.ReLU(),
        nn.Linear(24, 48), nn.ReLU(),
        nn.Linear(48, 96), nn.ReLU(),
        nn.Linear(96, d),
    ).to(device)
    opt = torch.optim.Adam(model.parameters(), lr=1e-3)
    loss_fn = nn.MSELoss()

    Xl_dev = Xl.to(device)
    for epoch in range(30):
        perm = torch.randperm(len(Xl_dev), device=device)
        epoch_loss = 0.0
        for i in range(0, len(Xl_dev), 1024):
            batch = Xl_dev[perm[i:i + 1024]]
            opt.zero_grad()
            loss = loss_fn(model(batch), batch)
            loss.backward()
            opt.step()
            epoch_loss += loss.item() * len(batch)
        if (epoch + 1) % 10 == 0:
            print(f"  ae epoch {epoch + 1}: recon mse={epoch_loss / len(Xl_dev):.4f}")

    model.eval()

    def scorer(X: np.ndarray) -> np.ndarray:
        with torch.no_grad():
            Xs = torch.tensor(scaler.transform(X), dtype=torch.float32).to(device)
            return ((model(Xs) - Xs) ** 2).mean(dim=1).cpu().numpy()

    scores, elapsed = timed_score(scorer, X_eval)
    metrics = evaluate_scores(y_eval, scores)
    metrics["inference_sec"] = round(elapsed, 3)
    torch.save(model.state_dict(), MODELS_DIR / "autoencoder.pt")
    joblib.dump(scaler, MODELS_DIR / "autoencoder_scaler.joblib")
    return metrics, scores


def main() -> None:
    df = load_dataset()
    cols = feature_cols(df)
    train, val, _ = temporal_split(df)
    licit = train[train["label"] == 0]
    X_licit, _ = xy(licit, cols)
    X_val, y_val = xy(val, cols)
    print(f"anomaly training on {len(X_licit):,} licit transactions")

    print("[isolation_forest]")
    m, _ = run_isolation_forest(X_licit, X_val, y_val)
    save_metrics("anomaly_isolation_forest",
                 {"model": "isolation_forest", "family": "anomaly", "split": "temporal",
                  "val": m, "params": "n_estimators=300, contamination=auto"})
    print(f"  AP={m['avg_precision']:.3f} P@100={m['precision@100']:.3f}")

    print("[autoencoder]")
    m, _ = run_autoencoder(X_licit, X_val, y_val)
    save_metrics("anomaly_autoencoder",
                 {"model": "autoencoder", "family": "anomaly", "split": "temporal",
                  "val": m, "params": "96-48-24-48-96, 30 epochs, Adam 1e-3"})
    print(f"  AP={m['avg_precision']:.3f} P@100={m['precision@100']:.3f}")


if __name__ == "__main__":
    main()
