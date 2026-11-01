"""ChainSleuth AML - local API backend.

Serves trained-model scores and explanations to the Next.js frontend.
Everything runs locally - no external calls, no deployment.

Run from project root:  uvicorn backend.main:app --reload --port 8000
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import joblib
import networkx as nx
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from chainsleuth.config import DATA_PROCESSED, MODELS_DIR
from chainsleuth.data import load_dataset, load_raw
from chainsleuth.splits import feature_cols

LABEL_MAP = {1: "illicit", 0: "licit", -1: "unknown"}

app = FastAPI(title="ChainSleuth AML", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

_state: dict = {}


def state():
    """Lazy-load dataset, scores, edges, model on first request."""
    if not _state:
        scores = pd.read_parquet(DATA_PROCESSED / "test_scores.parquet")
        df = load_dataset()
        _, _, edges = load_raw()
        _state.update(
            scores=scores,
            df=df,
            edges=edges,
            label=df.set_index("tx_id")["label"],
            cols=feature_cols(df),
            feat=df.set_index("tx_id"),
            model=joblib.load(MODELS_DIR / "xgboost.joblib"),
            # adjacency for neighbourhood queries (undirected)
            adj={},
        )
        out_adj: dict[int, set[int]] = {}
        in_adj: dict[int, set[int]] = {}
        for s, d in edges[["src_tx", "dst_tx"]].itertuples(index=False):
            out_adj.setdefault(int(s), set()).add(int(d))
            in_adj.setdefault(int(d), set()).add(int(s))
        _state["out_adj"] = out_adj
        _state["in_adj"] = in_adj
    return _state


def explainer():
    if "explainer" not in _state:
        import shap
        _state["explainer"] = shap.TreeExplainer(state()["model"])
    return _state["explainer"]


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/summary")
def summary():
    s = state()["scores"]
    return {
        "n_scored": int(len(s)),
        "n_labeled_illicit": int((s["label"] == 1).sum()),
        "n_labeled_licit": int((s["label"] == 0).sum()),
        "n_unknown": int((s["label"] < 0).sum()),
        "time_steps": sorted(int(t) for t in s["time_step"].unique()),
    }


@app.get("/api/alerts")
def alerts(
    min_score: float = Query(0.0, ge=0.0, le=1.0),
    label: str = Query("all"),  # all | illicit | licit | unknown
    step_min: int = 35, step_max: int = 49,
    limit: int = Query(500, le=5000),
    offset: int = 0,
):
    s = state()["scores"].copy()
    s["rank_score"] = s["score_hybrid_calibrated"].fillna(s["score_hybrid"])
    s = s[
        (s["rank_score"] >= min_score)
        & s["time_step"].between(step_min, step_max)
    ]
    if label != "all":
        code = {"illicit": 1, "licit": 0, "unknown": -1}[label]
        s = s[s["label"] == code]
    s = s.sort_values("rank_score", ascending=False)
    total = len(s)
    s = s.iloc[offset: offset + limit]
    return {
        "total": int(total),
        "rows": [
            {
                "tx_id": int(r.tx_id),
                "time_step": int(r.time_step),
                "label": LABEL_MAP[int(r.label)],
                "score": float(r.rank_score),
                "xgb": float(r.score_xgb) if pd.notna(r.score_xgb) else None,
                "gnn": float(r.score_gnn) if pd.notna(r.score_gnn) else None,
            }
            for r in s.itertuples()
        ],
    }


@app.get("/api/tx/{tx_id}")
def transaction(tx_id: int):
    st = state()
    rows = st["scores"][st["scores"]["tx_id"] == tx_id]
    if rows.empty:
        raise HTTPException(404, "transaction not in test window")
    r = rows.iloc[0]
    scores = {c.replace("score_", ""): float(r[c])
              for c in rows.columns if c.startswith("score_") and pd.notna(r[c])}
    return {
        "tx_id": int(tx_id),
        "time_step": int(r.time_step),
        "label": LABEL_MAP[int(r.label)],
        "scores": scores,
    }


@app.get("/api/tx/{tx_id}/explain")
def explain(tx_id: int, top: int = 15):
    st = state()
    if tx_id not in st["feat"].index:
        raise HTTPException(404, "features not found for transaction")
    X = st["feat"].loc[[tx_id], st["cols"]].to_numpy(np.float32)
    sv = explainer().shap_values(X)[0]
    contrib = sorted(
        ({"feature": f, "shap": float(v), "value": float(X[0][st["cols"].index(f)])}
         for f, v in zip(st["cols"], sv)),
        key=lambda d: abs(d["shap"]), reverse=True,
    )[:top]
    return {"tx_id": tx_id, "model": "xgboost", "contributions": contrib}


@app.get("/api/tx/{tx_id}/graph")
def graph(tx_id: int, hops: int = Query(1, ge=1, le=2), max_nodes: int = 120):
    """Directed flow neighbourhood: predecessors (hop<0) -> tx -> successors (hop>0).

    Signed hop distance drives the left-to-right Arkham-style layout.
    """
    st = state()
    out_adj, in_adj = st["out_adj"], st["in_adj"]
    if tx_id not in out_adj and tx_id not in in_adj and tx_id not in st["feat"].index:
        raise HTTPException(404, "transaction not found")

    def bse(direction_map, sign):
        dist = {}
        frontier = {tx_id}
        for h in range(1, hops + 1):
            nxt = set()
            for n in frontier:
                nxt.update(direction_map.get(n, ()))
            frontier = nxt - set(dist) - {tx_id}
            for n in frontier:
                dist[n] = sign * h
        return dist

    succ = bse(out_adj, +1)      # where funds flow TO
    pred = bse(in_adj, -1)       # where funds came FROM
    signed: dict[int, int] = {}
    for n in set(succ) | set(pred):
        s, p = succ.get(n), pred.get(n)
        if s is None:
            signed[n] = p
        elif p is None:
            signed[n] = s
        else:
            signed[n] = s if abs(s) <= abs(p) else p
    signed[tx_id] = 0

    # center first, then nearest hops; sort by |hop| so tx_id is never truncated
    nodes = sorted(signed, key=lambda n: (abs(signed[n]), signed[n], n))[:max_nodes]
    node_set = set(nodes)
    lab = st["label"]
    score_map = st["scores"].set_index("tx_id")["score_hybrid_calibrated"] \
        .fillna(st["scores"].set_index("tx_id")["score_hybrid"])
    links = [
        {"source": a, "target": b}
        for a in nodes for b in out_adj.get(a, ())
        if b in node_set
    ]
    return {
        "nodes": [
            {
                "id": int(n),
                "label": LABEL_MAP[int(lab.get(n, -1))],
                "is_center": n == tx_id,
                "hop": signed[n],
                "degree": len(out_adj.get(n, ())) + len(in_adj.get(n, ())),
                "score": float(score_map[n]) if n in score_map.index
                         and pd.notna(score_map[n]) else None,
            }
            for n in nodes
        ],
        "links": links,
    }
