"""Phase 8: hand-engineered graph-topology features (NetworkX) + the
'tabular vs tabular+graph' comparison on the validation slice.

Features are purely structural (no labels): degree stats, PageRank, k-core,
clustering coefficient, component size. They are computed on the FULL graph,
which is legitimate in the transductive setting (edges are observable data;
labels are what we predict) - same protocol the GNN uses.

Run: python -m experiments.graph_features
"""
from __future__ import annotations

import joblib
import networkx as nx
import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score
from xgboost import XGBClassifier

from chainsleuth.config import DATA_PROCESSED, METRICS_DIR, MODELS_DIR, SEED
from chainsleuth.data import load_dataset, load_raw
from chainsleuth.experiments import save_metrics
from chainsleuth.metrics import evaluate_scores, timed_score
from chainsleuth.splits import feature_cols, temporal_split, xy

GRAPH_FEATURE_PATH = DATA_PROCESSED / "graph_features.parquet"
GRAPH_COLS = ["in_degree", "out_degree", "pagerank", "k_core",
              "clustering", "component_size", "reciprocity", "mean_neighbor_degree"]


def compute_graph_features() -> pd.DataFrame:
    """One row per transaction: structural features from the flow graph."""
    df = load_dataset()
    _, _, edges = load_raw()
    G = nx.DiGraph()
    G.add_nodes_from(df["tx_id"].tolist())
    G.add_edges_from(edges[["src_tx", "dst_tx"]].itertuples(index=False))
    G_und = G.to_undirected()

    print("  pagerank / k-core / clustering / components ...")
    pagerank = nx.pagerank(G, alpha=0.85)
    kcore = nx.core_number(G_und)
    clustering = nx.clustering(G_und)
    comp_size = {n: len(c) for c in nx.weakly_connected_components(G) for n in c}
    reciprocity = {n: sum(1 for s in G.successors(n) if G.has_edge(s, n))
                   for n in G.nodes}
    mean_nbr_deg = {
        n: (np.mean([G_und.degree[m] for m in G_und.neighbors(n)]) if G_und.degree(n) else 0.0)
        for n in G.nodes
    }

    feats = pd.DataFrame({
        "tx_id": df["tx_id"],
        "in_degree": df["tx_id"].map(dict(G.in_degree())).fillna(0),
        "out_degree": df["tx_id"].map(dict(G.out_degree())).fillna(0),
        "pagerank": df["tx_id"].map(pagerank),
        "k_core": df["tx_id"].map(kcore).fillna(0),
        "clustering": df["tx_id"].map(clustering).fillna(0.0),
        "component_size": df["tx_id"].map(comp_size).fillna(1),
        "reciprocity": df["tx_id"].map(reciprocity).fillna(0),
        "mean_neighbor_degree": df["tx_id"].map(mean_nbr_deg).fillna(0.0),
    })
    feats.to_parquet(GRAPH_FEATURE_PATH)
    print(f"  graph features -> {GRAPH_FEATURE_PATH}")
    return feats


def main() -> None:
    feats = (pd.read_parquet(GRAPH_FEATURE_PATH) if GRAPH_FEATURE_PATH.exists()
             else compute_graph_features())
    df = load_dataset().merge(feats, on="tx_id", how="left")
    train, val, _ = temporal_split(df)

    base_cols = feature_cols(df)
    all_cols = base_cols + GRAPH_COLS

    X_train, y_train = xy(train, base_cols)
    X_val, y_val = xy(val, base_cols)
    Xg_train, _ = xy(train, all_cols)
    Xg_val, _ = xy(val, all_cols)

    import json
    params = json.loads((METRICS_DIR / "tuned_xgboost.json").read_text())["params"]

    print("[xgb: tabular only]")
    m1 = XGBClassifier(**params, tree_method="hist", device="cuda",
                       eval_metric="aucpr", random_state=SEED, n_jobs=-1)
    m1.fit(X_train, y_train)
    s1, _ = timed_score(lambda X: m1.predict_proba(X)[:, 1], X_val)
    r1 = evaluate_scores(y_val, s1)
    print(f"  AP={r1['avg_precision']:.4f}")

    print("[xgb: tabular + graph features]")
    m2 = XGBClassifier(**params, tree_method="hist", device="cuda",
                       eval_metric="aucpr", random_state=SEED, n_jobs=-1)
    m2.fit(Xg_train, y_train)
    s2, _ = timed_score(lambda X: m2.predict_proba(X)[:, 1], Xg_val)
    r2 = evaluate_scores(y_val, s2)
    print(f"  AP={r2['avg_precision']:.4f}")

    imp = pd.Series(m2.feature_importances_, index=all_cols)
    graph_share = imp[GRAPH_COLS].sum() / imp.sum()
    print(f"  graph features share of total importance: {graph_share:.1%}")
    print("  top graph features:", imp[GRAPH_COLS].sort_values(ascending=False).head(3).to_dict())

    save_metrics("experiment_graph_features_xgboost", {
        "model": "xgboost+graph_features", "family": "experiment", "split": "temporal",
        "val": r2, "val_baseline_tabular_only": r1,
        "graph_importance_share": float(graph_share),
        "note": "topology-only features; label-free; transductive protocol"})
    joblib.dump(m2, MODELS_DIR / "xgboost_graph_features.joblib")


if __name__ == "__main__":
    main()
