"""ChainSleuth AML - local API backend.

Serves trained-model scores and explanations to the Next.js frontend.
Everything runs locally - no external calls, no deployment.

Run from project root:  uvicorn backend.main:app --reload --port 8000
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import joblib
import networkx as nx
import numpy as np
import pandas as pd
from fastapi import Body, FastAPI, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse
from fastapi.middleware.cors import CORSMiddleware

from chainsleuth.config import DATA_PROCESSED, MODELS_DIR
from chainsleuth.data import load_dataset, load_raw
from chainsleuth.splits import feature_cols

from backend import scoring
from backend import workflow as wf

LABEL_MAP = {1: "illicit", 0: "licit", -1: "unknown"}

app = FastAPI(title="ChainSleuth AML", version="0.1.0")
# frontend/ dev server runs on 3001, website/ console on 4430. Override with a
# comma-separated CHAINSLEUTH_ORIGINS when serving from somewhere else.
DEFAULT_ORIGINS = [
    f"http://{host}:{port}"
    for port in (3000, 3001, 4430)
    for host in ("localhost", "127.0.0.1")
]
ORIGINS = [o.strip() for o in os.environ.get("CHAINSLEUTH_ORIGINS", "").split(",") if o.strip()] \
    or DEFAULT_ORIGINS

app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGINS,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
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
    s = s.sort_values(["rank_score", "score_hybrid"], ascending=False)
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
    steps = st["feat"]["time_step"]
    return {
        "nodes": [
            {
                "id": int(n),
                "label": LABEL_MAP[int(lab.get(n, -1))],
                "is_center": n == tx_id,
                "hop": signed[n],
                "degree": len(out_adj.get(n, ())) + len(in_adj.get(n, ())),
                "time_step": int(steps.get(n, -1)),
                "score": float(score_map[n]) if n in score_map.index
                         and pd.notna(score_map[n]) else None,
            }
            for n in nodes
        ],
        "links": links,
    }


# ---------------------------------------------------------------- console
# The website console (website/app/dashboard) reads model scores from the
# parquet above and keeps analyst actions in backend/workflow.py.

def _rank_score(s: pd.DataFrame) -> pd.Series:
    return s["score_hybrid_calibrated"].fillna(s["score_hybrid"])


def _opt(v) -> float | None:
    return None if v is None or pd.isna(v) else round(float(v), 4)


def queue_frame() -> pd.DataFrame:
    """Test-window scores with display columns, cached after first build.

    Autoencoder error and isolation-forest score are unbounded, so the console
    shows their percentile within the test window instead of the raw value.
    """
    st = state()
    if "queue" not in st:
        s = st["scores"].copy()
        s["hybrid"] = _rank_score(s)
        for k in ("ae", "iso"):
            col = f"score_{k}"
            s[f"{k}_pct"] = s[col].rank(pct=True) if col in s else np.nan
        s["in_deg"] = s["tx_id"].map(lambda n: len(st["in_adj"].get(int(n), ())))
        s["out_deg"] = s["tx_id"].map(lambda n: len(st["out_adj"].get(int(n), ())))
        # isotonic calibration is a step function -> many exact ties at the top;
        # the uncalibrated blend breaks them so the order is stable and meaningful
        st["queue"] = s.sort_values(["hybrid", "score_hybrid"], ascending=False).reset_index(drop=True)
    return st["queue"]


def _alert_rows(frame: pd.DataFrame, states: dict[int, dict]) -> list[dict]:
    rows = []
    for r in frame.itertuples(index=False):
        tx = int(r.tx_id)
        ws = states.get(tx, {})
        rows.append({
            "id": tx,
            "step": int(r.time_step),
            "label": LABEL_MAP[int(r.label)],
            "hybrid": _opt(r.hybrid),
            "xgb": _opt(getattr(r, "score_xgb", None)),
            "gnn": _opt(getattr(r, "score_gnn", None)),
            "rf": _opt(getattr(r, "score_rf", None)),
            "ae": _opt(r.ae_pct),
            "iso": _opt(r.iso_pct),
            "inDeg": int(r.in_deg),
            "outDeg": int(r.out_deg),
            "status": ws.get("status", "new"),
            "assignee": ws.get("assignee"),
            "caseId": ws.get("caseId"),
            "notes": ws.get("notes", []),
        })
    return rows


def snapshot(con, limit: int) -> dict:
    q = queue_frame()
    touched = wf.touched_tx_ids(con)
    frame = pd.concat([q.head(limit), q[q["tx_id"].isin(touched)]]).drop_duplicates("tx_id")
    frame = frame.sort_values(["hybrid", "score_hybrid"], ascending=False)
    cfg = wf.settings(con)
    return {
        "alerts": _alert_rows(frame, wf.alert_states(con)),
        "cases": wf.cases(con),
        "activity": wf.activity(con),
        "settings": cfg,
        "window": {
            "n_scored": int(len(q)),
            "steps": [int(q["time_step"].min()), int(q["time_step"].max())],
            "limit": limit,
            # over the whole window, not just the rows sent back
            "above_threshold": int((q["hybrid"] >= cfg["threshold"]).sum()),
        },
    }


QUEUE_LIMIT = 500


def _act(fn, limit: int = QUEUE_LIMIT) -> dict:
    """Run one workflow mutation and return the fresh snapshot (or a 400)."""
    with wf.connect() as con:
        try:
            extra = fn(con)
        except wf.WorkflowError as e:
            raise HTTPException(400, str(e)) from e
        out = snapshot(con, limit)
    if isinstance(extra, dict):
        out.update(extra)
    return out


def _who(con, body: dict) -> str:
    return (body.get("who") or wf.settings(con)["analyst"]).strip() or "Analyst"


def _ids(body: dict) -> list[int]:
    ids = body.get("ids")
    if not isinstance(ids, list) or not all(isinstance(i, int) for i in ids):
        raise HTTPException(422, "ids must be a list of integers")
    return ids


@app.get("/api/console")
def console(limit: int = Query(QUEUE_LIMIT, ge=1, le=5000)):
    with wf.connect() as con:
        return snapshot(con, limit)


@app.post("/api/console/alerts/assign")
def console_assign(body: dict = Body(...)):
    ids = _ids(body)
    return _act(lambda con: wf.assign(con, ids, _who(con, body)))


@app.post("/api/console/alerts/status")
def console_status(body: dict = Body(...)):
    ids = _ids(body)
    return _act(lambda con: wf.set_status(con, ids, str(body.get("status")), _who(con, body)))


@app.post("/api/console/alerts/escalate")
def console_escalate(body: dict = Body(...)):
    ids = _ids(body)
    return _act(lambda con: {"caseId": wf.escalate(
        con, ids, str(body.get("caseId", "new")), _who(con, body), body.get("title"))})


@app.post("/api/console/alerts/{tx_id}/notes")
def console_alert_note(tx_id: int, body: dict = Body(...)):
    return _act(lambda con: wf.add_note(con, _who(con, body), str(body.get("text", "")), tx_id=tx_id))


@app.post("/api/console/cases")
def console_create_case(body: dict = Body(...)):
    txs = body.get("txs") or []
    return _act(lambda con: {"caseId": wf.create_case(
        con, str(body.get("title", "")), _who(con, body), [int(t) for t in txs])})


@app.post("/api/console/cases/{case_id}/status")
def console_case_status(case_id: str, body: dict = Body(...)):
    return _act(lambda con: wf.set_case_status(con, case_id, str(body.get("status")), _who(con, body)))


@app.post("/api/console/cases/{case_id}/notes")
def console_case_note(case_id: str, body: dict = Body(...)):
    return _act(lambda con: wf.add_note(con, _who(con, body), str(body.get("text", "")), case_id=case_id))


@app.delete("/api/console/cases/{case_id}/txs/{tx_id}")
def console_remove_from_case(case_id: str, tx_id: int, who: str | None = None):
    return _act(lambda con: wf.remove_from_case(con, case_id, tx_id, who or wf.settings(con)["analyst"]))


@app.put("/api/console/settings")
def console_settings(body: dict = Body(...)):
    return _act(lambda con: wf.update_settings(con, body))


@app.post("/api/console/reset")
def console_reset():
    return _act(wf.reset)


# ---------------------------------------------------------------- scoring
# Use the trained models directly: any transaction id in the dataset, or rows
# uploaded as CSV. backend/scoring.py has the parsing and the in-sample rules.

def rf_model():
    if "rf" not in _state:
        path = MODELS_DIR / "random_forest.joblib"
        _state["rf"] = joblib.load(path) if path.exists() else None
    return _state["rf"]


@app.get("/api/score/tx/{tx_id}")
def score_tx(tx_id: int, top: int = Query(10, ge=1, le=30)):
    st = state()
    if tx_id not in st["feat"].index:
        raise HTTPException(404, f"tx {tx_id} is not in the Elliptic dataset")
    row = st["feat"].loc[[tx_id]].reset_index()
    (scored,) = scoring.score_frame(row, st["model"], rf_model(), explainer(), top=top, labels=st["label"])
    s = st["scores"]
    hit = s[s["tx_id"] == tx_id]
    hybrid = None
    if not hit.empty:
        hybrid = _opt(_rank_score(hit).iloc[0])
    return {
        **scored,
        "label": LABEL_MAP[int(st["label"].get(tx_id, -1))],
        "hybrid": hybrid,
        "in_degree": len(st["in_adj"].get(tx_id, ())),
        "out_degree": len(st["out_adj"].get(tx_id, ())),
    }


@app.post("/api/score/batch")
async def score_batch(request: Request):
    """Body: CSV text (raw Elliptic layout or a header naming local_*/agg_*)."""
    raw = await request.body()
    try:
        frame = scoring.parse_csv(raw)
    except scoring.ScoreInputError as e:
        raise HTTPException(422, str(e)) from e
    st = state()
    rows = scoring.score_frame(frame, st["model"], rf_model(), explainer(), labels=st["label"])
    labels = st["label"]
    for r in rows:
        r["label"] = LABEL_MAP[int(labels.get(r["tx_id"], -1))] if r["tx_id"] is not None else "unknown"
    xs = np.array([r["xgb"] for r in rows])
    return {
        "n": len(rows),
        "n_flagged": int((xs >= 0.5).sum()),
        "n_in_sample": sum(r["in_sample"] for r in rows),
        "rows": rows,
    }


@app.get("/api/score/sample", response_class=PlainTextResponse)
def score_sample(n: int = Query(25, ge=1, le=scoring.MAX_ROWS),
                 label: str = Query("any", pattern="^(any|illicit|licit|unknown)$"),
                 seed: int = 0):
    """Real test-window rows in the raw Elliptic CSV layout, to try the upload with."""
    st = state()
    return PlainTextResponse(scoring.sample_csv(st["df"], n, label, seed), media_type="text/csv",
                             headers={"content-disposition": f'attachment; filename="elliptic_sample_{label}_{n}.csv"'})
