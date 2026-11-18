"""Scoring: CSV parsing, in-sample flags, and the /api/score endpoints."""
import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend import main, scoring
from backend.scoring import FEATURES


def _raw_rows(n=3, step=40):
    rng = np.random.default_rng(0)
    return "\n".join(
        ",".join([str(1000 + i), str(step)] + [f"{v:.6g}" for v in rng.normal(size=165)])
        for i in range(n)
    ).encode()


def test_parse_raw_elliptic_layout():
    df = scoring.parse_csv(_raw_rows(3))
    assert list(df.columns) == ["tx_id", "time_step", *FEATURES]
    assert df.tx_id.tolist() == [1000, 1001, 1002] and len(df) == 3


def test_parse_scientific_notation_is_not_a_header():
    raw = b"5,40," + b",".join([b"1e-05"] * 165)
    assert len(scoring.parse_csv(raw)) == 1


def test_parse_named_header_without_ids():
    header = ",".join(["label", *FEATURES])
    row = ",".join(["1"] + ["0.5"] * 165)
    df = scoring.parse_csv(f"{header}\n{row}\n".encode())
    assert np.isnan(df.tx_id.iat[0]) and df["agg_72"].iat[0] == 0.5


@pytest.mark.parametrize("raw, msg", [
    (b"", "empty"),
    (b"1,2,3", "columns"),
    ("tx_id,local_1\n1,2".encode(), "missing"),
    (b"1,40," + b",".join([b"x"] * 165), "non-numeric"),
])
def test_parse_errors_are_specific(raw, msg):
    with pytest.raises(scoring.ScoreInputError, match=msg):
        scoring.parse_csv(raw)


def test_row_limit(monkeypatch):
    monkeypatch.setattr(scoring, "MAX_ROWS", 2)
    with pytest.raises(scoring.ScoreInputError, match="limit"):
        scoring.parse_csv(_raw_rows(3))


def test_windows_and_in_sample():
    assert scoring.window_of(5) == "train" and scoring.in_sample(5)
    assert scoring.window_of(32) == "validation" and scoring.in_sample(32)
    assert scoring.window_of(40) == "test" and not scoring.in_sample(40)
    assert scoring.window_of(None) == "unknown" and not scoring.in_sample(None)


class _Model:
    """Probability = sigmoid of local_1, so tests can predict the output."""

    def predict_proba(self, X):
        p = 1 / (1 + np.exp(-X[:, 0]))
        return np.column_stack([1 - p, p])


class _Explainer:
    def shap_values(self, X):
        sv = np.zeros_like(X)
        sv[:, 0] = X[:, 0]
        sv[:, 5] = -0.1
        return sv


@pytest.fixture()
def client(monkeypatch):
    feats = pd.DataFrame(0.0, index=range(3), columns=FEATURES)
    feats["local_1"] = [3.0, -3.0, 0.0]
    df = pd.concat([pd.DataFrame({"tx_id": [7, 8, 9], "time_step": [10, 40, 45],
                                  "label": [1, 0, -1]}), feats], axis=1)
    scores = pd.DataFrame({"tx_id": [8, 9], "time_step": [40, 45], "label": [0, -1],
                           "score_hybrid": [0.1, 0.4], "score_hybrid_calibrated": [0.05, np.nan]})
    main._state.clear()
    main._state.update(df=df, feat=df.set_index("tx_id"), label=df.set_index("tx_id")["label"],
                       scores=scores, model=_Model(), rf=_Model(), explainer=_Explainer(),
                       out_adj={7: {8}}, in_adj={8: {7}})
    yield TestClient(main.app)
    main._state.clear()


def test_score_known_tx_in_training_window(client):
    r = client.get("/api/score/tx/7").json()
    assert r["label"] == "illicit" and r["window"] == "train" and r["in_sample"] is True
    assert r["xgb"] == pytest.approx(0.9526, abs=1e-4)
    assert r["reasons"][0]["feature"] == "local_1" and r["hybrid"] is None
    assert r["out_degree"] == 1


def test_score_test_window_tx_carries_hybrid(client):
    r = client.get("/api/score/tx/9").json()
    assert r["window"] == "test" and r["in_sample"] is False and r["hybrid"] == 0.4


def test_score_unknown_tx_404(client):
    assert client.get("/api/score/tx/123").status_code == 404


def test_batch_scores_uploaded_rows(client):
    raw = "\n".join([",".join(["8", "40", "2"] + ["0"] * 164), ",".join(["555", "41", "-2"] + ["0"] * 164)])
    r = client.post("/api/score/batch", content=raw, headers={"content-type": "text/csv"}).json()
    assert r["n"] == 2 and r["n_flagged"] == 1 and r["n_in_sample"] == 0
    assert r["rows"][0]["label"] == "licit" and r["rows"][1]["label"] == "unknown"


def test_batch_bad_csv_is_422(client):
    r = client.post("/api/score/batch", content=b"a,b\n1,2", headers={"content-type": "text/csv"})
    assert r.status_code == 422 and "missing" in r.json()["detail"]


def test_sample_is_real_test_window_rows_and_round_trips(client):
    csv = client.get("/api/score/sample", params={"n": 5}).text
    lines = csv.strip().splitlines()
    assert len(lines) == 2  # only tx 8 and 9 are in steps 35-49
    assert {line.split(",")[0] for line in lines} == {"8", "9"}
    r = client.post("/api/score/batch", content=csv, headers={"content-type": "text/csv"}).json()
    assert r["n"] == 2
