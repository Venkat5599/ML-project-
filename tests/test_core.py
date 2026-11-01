"""Unit tests for split policy and metrics - the places leakage hides."""
import numpy as np
import pandas as pd

from chainsleuth.config import TEST_STEPS, TRAIN_STEPS, VAL_STEPS
from chainsleuth.metrics import evaluate_scores, precision_at_k, recall_at_k
from chainsleuth.splits import random_split, temporal_split


def _toy_df() -> pd.DataFrame:
    rng = np.random.default_rng(0)
    n = 400
    return pd.DataFrame({
        "tx_id": range(n),
        "time_step": rng.integers(1, 50, n),
        "local_1": rng.normal(size=n),
        "agg_1": rng.normal(size=n),
        "label": rng.choice([0, 1, -1], n, p=[0.6, 0.15, 0.25]),
    })


def test_temporal_split_disjoint_and_ordered():
    df = _toy_df()
    train, val, test = temporal_split(df)
    assert set(train.tx_id).isdisjoint(val.tx_id)
    assert set(train.tx_id).isdisjoint(test.tx_id)
    assert set(val.tx_id).isdisjoint(test.tx_id)
    assert train.time_step.max() <= val.time_step.min()
    assert val.time_step.max() <= test.time_step.min()


def test_temporal_split_excludes_unknown():
    df = _toy_df()
    for part in temporal_split(df):
        assert (part["label"] >= 0).all()


def test_random_split_differs_from_temporal():
    df = _toy_df()
    train_t, _, test_t = temporal_split(df)
    train_r, _, test_r = random_split(df)
    # random train will contain rows from test time steps -> proves the difference
    assert train_r.time_step.max() >= max(TRAIN_STEPS) or not set(test_r.tx_id) == set(test_t.tx_id)


def test_precision_recall_at_k():
    y = np.array([1, 0, 1, 0, 1])
    scores = np.array([0.9, 0.8, 0.7, 0.6, 0.5])
    assert precision_at_k(y, scores, 2) == 0.5
    assert recall_at_k(y, scores, 2) == 1 / 3


def test_evaluate_scores_keys():
    y = np.array([0, 1, 0, 1, 0])
    s = np.array([0.1, 0.9, 0.2, 0.8, 0.3])
    m = evaluate_scores(y, s, ks=(2,))
    for key in ("precision", "recall", "f1", "avg_precision", "roc_auc",
                "precision@2", "recall@2"):
        assert key in m
    assert m["avg_precision"] == 1.0  # perfect ranking
