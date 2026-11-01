"""Shared helpers for experiment scripts: scoring, logging, saving metrics."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from .config import METRICS_DIR


def save_metrics(name: str, payload: dict) -> Path:
    """Persist an experiment result as JSON under results/metrics/."""
    path = METRICS_DIR / f"{name}.json"
    with open(path, "w") as f:
        json.dump(payload, f, indent=2)
    print(f"saved -> {path}")
    return path


def collect_metrics(names: list[str] | None = None) -> pd.DataFrame:
    """Load all saved metric JSONs into a comparison DataFrame."""
    rows = []
    for path in sorted(METRICS_DIR.glob("*.json")):
        if names and path.stem not in names:
            continue
        payload = json.loads(path.read_text())
        row = {"experiment": path.stem}
        row.update(payload.get("test", payload))
        row["model"] = payload.get("model", path.stem)
        row["family"] = payload.get("family", "")
        rows.append(row)
    return pd.DataFrame(rows)


def normalize_scores(scores: np.ndarray) -> np.ndarray:
    """Min-max normalize anomaly-style scores to [0, 1] for threshold reporting."""
    lo, hi = scores.min(), scores.max()
    if hi - lo < 1e-12:
        return np.zeros_like(scores)
    return (scores - lo) / (hi - lo)
