"""HTTP contract of the backend, run against a tiny in-memory test window.

The real app loads data/processed/test_scores.parquet on first request; here
the same `_state` dict is filled with a 6-transaction fixture instead.
"""
import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend import main


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("CHAINSLEUTH_DB", str(tmp_path / "wf.sqlite"))
    scores = pd.DataFrame({
        "tx_id": [1, 2, 3, 4, 5, 6],
        "time_step": [35, 36, 40, 41, 49, 35],
        "label": [1, 0, -1, 1, -1, 0],
        "score_xgb": [0.99, 0.10, 0.70, 0.80, 0.20, 0.05],
        "score_gnn": [0.90, 0.20, np.nan, 0.60, 0.30, 0.10],
        "score_rf": [0.95, 0.10, 0.60, 0.70, 0.20, 0.10],
        "score_ae": [5.0, 1.0, 3.0, 4.0, 2.0, 0.5],
        "score_iso": [0.6, 0.1, 0.4, 0.5, 0.2, 0.05],
        "score_hybrid": [0.97, 0.12, 0.66, 0.75, 0.22, 0.06],
        "score_hybrid_calibrated": [0.98, 0.05, np.nan, 0.80, 0.20, 0.01],
    })
    feat = scores[["tx_id", "time_step"]].set_index("tx_id")
    edges = [(1, 3), (3, 4), (2, 1), (4, 5)]
    out_adj, in_adj = {}, {}
    for s, d in edges:
        out_adj.setdefault(s, set()).add(d)
        in_adj.setdefault(d, set()).add(s)
    main._state.clear()
    main._state.update(scores=scores, feat=feat, label=scores.set_index("tx_id")["label"],
                       out_adj=out_adj, in_adj=in_adj)
    yield TestClient(main.app)
    main._state.clear()


def test_summary_counts(client):
    r = client.get("/api/summary").json()
    assert r["n_scored"] == 6 and r["n_labeled_illicit"] == 2 and r["n_unknown"] == 2


def test_alerts_rank_by_calibrated_then_raw(client):
    rows = client.get("/api/alerts").json()["rows"]
    assert [r["tx_id"] for r in rows][:3] == [1, 4, 3]  # tx 3 falls back to raw 0.66


def test_calibration_ties_broken_by_raw_blend(client):
    s = main._state["scores"]
    s.loc[s.tx_id.isin([1, 4]), "score_hybrid_calibrated"] = 0.9  # tie after calibration
    rows = client.get("/api/alerts").json()["rows"]
    assert [r["tx_id"] for r in rows][:2] == [1, 4]  # raw 0.97 beats 0.75
    s.loc[s.tx_id == 4, "score_hybrid"] = 0.99
    main._state.pop("queue", None)
    ids = [a["id"] for a in client.get("/api/console").json()["alerts"]]
    assert ids[:2] == [4, 1]


def test_alerts_label_filter(client):
    rows = client.get("/api/alerts", params={"label": "unknown"}).json()["rows"]
    assert {r["tx_id"] for r in rows} == {3, 5}


def test_console_snapshot_shape(client):
    snap = client.get("/api/console").json()
    assert set(snap) == {"alerts", "cases", "activity", "settings", "window"}
    top = snap["alerts"][0]
    assert top["id"] == 1 and top["status"] == "new" and top["inDeg"] == 1 and top["outDeg"] == 1
    assert 0 <= top["ae"] <= 1 and 0 <= top["iso"] <= 1  # percentiles, not raw error
    tx3 = next(a for a in snap["alerts"] if a["id"] == 3)
    assert tx3["gnn"] is None  # missing GNN score stays missing, never 0
    assert snap["window"] == {"n_scored": 6, "steps": [35, 49], "limit": 500, "above_threshold": 3}


def test_above_threshold_counts_beyond_the_limit(client):
    client.put("/api/console/settings", json={"threshold": 0.1})
    snap = client.get("/api/console", params={"limit": 1}).json()
    assert len(snap["alerts"]) == 1 and snap["window"]["above_threshold"] == 4


def test_console_limit_keeps_touched_alerts(client):
    client.post("/api/console/alerts/assign", json={"ids": [6], "who": "Ana"})
    ids = [a["id"] for a in client.get("/api/console", params={"limit": 2}).json()["alerts"]]
    assert ids[:2] == [1, 4] and 6 in ids


def test_escalate_round_trip(client):
    r = client.post("/api/console/alerts/escalate",
                    json={"ids": [1, 4], "caseId": "new", "title": "Peel chain", "who": "Ana"}).json()
    assert r["caseId"] == "CS-1001"
    assert r["cases"][0]["txs"] == [1, 4]
    a1 = next(a for a in r["alerts"] if a["id"] == 1)
    assert a1["status"] == "escalated" and a1["caseId"] == "CS-1001" and a1["assignee"] == "Ana"
    assert r["activity"][0]["text"] == "escalated 2 alerts to CS-1001"


def test_bad_status_is_400(client):
    r = client.post("/api/console/alerts/status", json={"ids": [1], "status": "gone"})
    assert r.status_code == 400


def test_ids_must_be_ints(client):
    assert client.post("/api/console/alerts/assign", json={"ids": ["1"]}).status_code == 422


def test_case_lifecycle(client):
    cid = client.post("/api/console/cases", json={"title": "Fan-out", "txs": [3]}).json()["caseId"]
    client.post(f"/api/console/cases/{cid}/notes", json={"text": "check t40"})
    r = client.post(f"/api/console/cases/{cid}/status", json={"status": "closed"}).json()
    case = r["cases"][0]
    assert case["status"] == "closed" and case["notes"][0]["text"] == "check t40"
    r = client.delete(f"/api/console/cases/{cid}/txs/3").json()
    assert r["cases"][0]["txs"] == []


def test_settings_analyst_is_default_actor(client):
    client.put("/api/console/settings", json={"analyst": "M. Chen"})
    r = client.post("/api/console/alerts/assign", json={"ids": [2]}).json()
    assert next(a for a in r["alerts"] if a["id"] == 2)["assignee"] == "M. Chen"
    assert client.put("/api/console/settings", json={"threshold": 3}).status_code == 400


def test_reset_clears_workflow(client):
    client.post("/api/console/alerts/escalate", json={"ids": [1], "caseId": "new"})
    r = client.post("/api/console/reset").json()
    assert r["cases"] == [] and all(a["status"] == "new" for a in r["alerts"])


def test_flow_graph_is_directed(client):
    g = client.get("/api/tx/3/graph", params={"hops": 2}).json()
    hops = {n["id"]: n["hop"] for n in g["nodes"]}
    assert hops == {3: 0, 1: -1, 2: -2, 4: 1, 5: 2}
    assert {"source": 3, "target": 4} in g["links"]


def test_unknown_tx_404(client):
    assert client.get("/api/tx/999").status_code == 404
    assert client.get("/api/tx/999/graph").status_code == 404
