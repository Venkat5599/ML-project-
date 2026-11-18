"""Leakage guards on the feature list and the GNN graph masks."""
import numpy as np
import pandas as pd
import pytest

from chainsleuth import graph as g
from chainsleuth.data import FEATURE_COLUMNS
from chainsleuth.splits import feature_cols, random_split


def _frame(n=300, seed=1):
    rng = np.random.default_rng(seed)
    df = pd.DataFrame(rng.normal(size=(n, len(FEATURE_COLUMNS))), columns=FEATURE_COLUMNS)
    df["tx_id"] = np.arange(1000, 1000 + n)
    df["time_step"] = rng.integers(1, 50, n)
    df["label"] = rng.choice([1, 0, -1], n, p=[0.15, 0.45, 0.4])
    return df


def test_feature_cols_are_the_165_elliptic_features_only():
    cols = feature_cols(_frame())
    assert len(cols) == 165
    assert not {"tx_id", "time_step", "label"} & set(cols)


def test_reduced_feature_set_drops_aggregates():
    cols = feature_cols(_frame(), include_agg=False)
    assert len(cols) == 93 and all(c.startswith("local_") for c in cols)


def test_random_split_is_stratified_and_labelled_only():
    df = _frame(2000)
    parts = random_split(df)
    rate = (df[df.label >= 0].label == 1).mean()
    for p in parts:
        assert (p.label >= 0).all()
        assert abs((p.label == 1).mean() - rate) < 0.03
    assert sum(len(p) for p in parts) == (df.label >= 0).sum()


@pytest.fixture()
def graph(tmp_path, monkeypatch):
    df = _frame()
    ids = df.tx_id.to_numpy()
    edges = pd.DataFrame({"src_tx": ids[:-1], "dst_tx": ids[1:]})
    monkeypatch.setattr(g, "GRAPH_PATH", tmp_path / "graph.pt")
    monkeypatch.setattr(g, "load_dataset", lambda: df)
    monkeypatch.setattr(g, "load_raw", lambda: (None, None, edges))
    return df, g.build_graph()


def test_graph_masks_are_disjoint_and_never_include_unknown(graph):
    df, data = graph
    tr, va, te = data.train_mask.numpy(), data.val_mask.numpy(), data.test_mask.numpy()
    assert not (tr & va).any() and not (tr & te).any() and not (va & te).any()
    unknown = (df.label < 0).to_numpy()
    assert not ((tr | va | te) & unknown).any()


def test_graph_scaler_is_fit_on_train_rows_only(graph):
    df, data = graph
    train = df[df.time_step.between(1, 29) & (df.label >= 0)]
    cols = feature_cols(df)
    np.testing.assert_allclose(data.scaler_mean, train[cols].mean().to_numpy(), rtol=1e-6, atol=1e-9)


def test_graph_edges_made_undirected(graph):
    df, data = graph
    assert data.num_edges == 2 * (len(df) - 1)
