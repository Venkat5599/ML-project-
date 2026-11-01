"""Build the PyG graph for Elliptic: nodes = transactions, directed edges = flows.

The dataset is transductive (single graph, masked labels). Edges only connect
transactions within the same time step (49 weak components), which means
label-propagated hand-features would need test-time labels we don't have.
The GNN legitimately gets that signal via semi-supervised message passing
instead - that contrast is part of the report narrative.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import torch
from sklearn.preprocessing import StandardScaler
from torch_geometric.data import Data
from torch_geometric.utils import to_undirected

from .config import DATA_PROCESSED, TEST_STEPS, TRAIN_STEPS, VAL_STEPS
from .data import load_dataset, load_raw
from .splits import feature_cols

GRAPH_PATH = DATA_PROCESSED / "graph.pt"


def build_graph(undirected: bool = True) -> Data:
    """Assemble torch_geometric.data.Data. Cached to data/processed/graph.pt.

    x: standardized features (scaler fit on TRAIN-window labeled rows only).
    y: 1=illicit, 0=licit, -1=unknown (unknown/val/test hidden via masks).
    """
    df = load_dataset()
    _, _, edges = load_raw()

    tx_ids = df["tx_id"].to_numpy()
    index_of = {tx: i for i, tx in enumerate(tx_ids)}
    cols = feature_cols(df)

    src = edges["src_tx"].map(index_of).to_numpy()
    dst = edges["dst_tx"].map(index_of).to_numpy()
    edge_index = torch.from_numpy(np.stack([src, dst])).long()
    if undirected:
        edge_index = to_undirected(edge_index)

    in_train = df["time_step"].isin(TRAIN_STEPS) & (df["label"] >= 0)
    scaler = StandardScaler().fit(df.loc[in_train, cols])
    x = torch.from_numpy(scaler.transform(df[cols]).astype(np.float32))
    y = torch.from_numpy(df["label"].to_numpy()).long()

    labeled = (df["label"] >= 0).to_numpy()
    data = Data(x=x, edge_index=edge_index, y=y)
    data.train_mask = torch.from_numpy(in_train.to_numpy())
    data.val_mask = torch.from_numpy(df["time_step"].isin(VAL_STEPS).to_numpy() & labeled)
    data.test_mask = torch.from_numpy(df["time_step"].isin(TEST_STEPS).to_numpy() & labeled)
    data.tx_id = torch.from_numpy(tx_ids)
    data.time_step = torch.from_numpy(df["time_step"].to_numpy())
    data.scaler_mean = scaler.mean_
    data.scaler_scale = scaler.scale_

    torch.save(data, GRAPH_PATH)
    print(f"graph: {data.num_nodes:,} nodes, {data.num_edges:,} edges, "
          f"{int(data.train_mask.sum()):,} train / {int(data.val_mask.sum()):,} val / "
          f"{int(data.test_mask.sum()):,} test labeled nodes")
    return data


def load_graph() -> Data:
    if not GRAPH_PATH.exists():
        return build_graph()
    return torch.load(GRAPH_PATH, weights_only=False)
