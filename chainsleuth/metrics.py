"""Evaluation metrics aligned with the investigation use case.

Higher score = more suspicious. Threshold-free metrics (AP, ROC-AUC) describe
ranking quality; @K metrics describe the top of the alert queue an analyst can
actually review; P/R/F1 use a fixed threshold (0.5 unless stated).
"""
from __future__ import annotations

import time
from typing import Callable

import numpy as np
from sklearn.metrics import (
    average_precision_score,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)

from .config import ALERT_KS


def precision_at_k(y_true: np.ndarray, scores: np.ndarray, k: int) -> float:
    k = min(k, len(scores))
    top = np.argsort(scores)[::-1][:k]
    return float(y_true[top].mean())


def recall_at_k(y_true: np.ndarray, scores: np.ndarray, k: int) -> float:
    total_pos = y_true.sum()
    if total_pos == 0:
        return float("nan")
    k = min(k, len(scores))
    top = np.argsort(scores)[::-1][:k]
    return float(y_true[top].sum() / total_pos)


def evaluate_scores(
    y_true: np.ndarray,
    scores: np.ndarray,
    ks: tuple[int, ...] = ALERT_KS,
    threshold: float = 0.5,
) -> dict:
    """Full metric bundle for a scorer on labeled data."""
    y_pred = (scores >= threshold).astype(int)
    out = {
        "precision": float(precision_score(y_true, y_pred, zero_division=0)),
        "recall": float(recall_score(y_true, y_pred, zero_division=0)),
        "f1": float(f1_score(y_true, y_pred, zero_division=0)),
        "avg_precision": float(average_precision_score(y_true, scores)),
        "roc_auc": float(roc_auc_score(y_true, scores)),
        "n_eval": int(len(y_true)),
        "n_positive": int(y_true.sum()),
    }
    for k in ks:
        out[f"precision@{k}"] = precision_at_k(y_true, scores, k)
        out[f"recall@{k}"] = recall_at_k(y_true, scores, k)
    return out


def timed_score(scorer: Callable[[np.ndarray], np.ndarray], X: np.ndarray) -> tuple[np.ndarray, float]:
    """Score a batch and return (scores, elapsed_seconds)."""
    t0 = time.perf_counter()
    scores = scorer(X)
    return scores, time.perf_counter() - t0
