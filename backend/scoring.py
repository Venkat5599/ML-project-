"""Score transactions with the trained models (lookup by id, or uploaded CSV).

The saved XGBoost and random-forest models (models/*.joblib, written by
experiments/evaluate.py) were refit on time steps 1-34. Scores for rows from
those steps are in-sample and therefore optimistic; every response says which
window a row came from so the UI can flag it.
"""
from __future__ import annotations

import io

import numpy as np
import pandas as pd

from chainsleuth.config import N_AGG_FEATURES, N_LOCAL_FEATURES, TEST_STEPS, TRAIN_STEPS, VAL_STEPS

FEATURES = ([f"local_{i}" for i in range(1, N_LOCAL_FEATURES + 1)]
            + [f"agg_{i}" for i in range(1, N_AGG_FEATURES + 1)])
MAX_ROWS = 5000
MAX_BYTES = 8_000_000


class ScoreInputError(ValueError):
    """The uploaded file can't be read as Elliptic feature rows."""


def window_of(step: int | None) -> str:
    if step is None:
        return "unknown"
    if step in TRAIN_STEPS:
        return "train"
    if step in VAL_STEPS:
        return "validation"
    if step in TEST_STEPS:
        return "test"
    return "unknown"


def in_sample(step: int | None) -> bool:
    """True when the saved models saw this time step during fitting (1-34)."""
    return step is not None and (step in TRAIN_STEPS or step in VAL_STEPS)


def _is_number(s: str) -> bool:
    try:
        float(s)
        return True
    except ValueError:
        return False


def parse_csv(raw: bytes) -> pd.DataFrame:
    """Read uploaded rows into tx_id, time_step + the 165 feature columns.

    Accepts the raw Elliptic layout (no header: txId, time step, 165 features)
    or a header row that names local_1..local_93 / agg_1..agg_72 (tx_id and
    time_step optional). Extra columns such as label are ignored.
    """
    if not raw.strip():
        raise ScoreInputError("the file is empty")
    if len(raw) > MAX_BYTES:
        raise ScoreInputError(f"file is larger than {MAX_BYTES // 1_000_000} MB")
    text = raw.decode("utf-8-sig", errors="replace")
    first = text.splitlines()[0]
    # raw Elliptic rows always start with two numbers (txId, time step)
    head = first.split(",")
    has_header = len(head) < 2 or not (_is_number(head[0]) and _is_number(head[1]))
    try:
        if has_header:
            df = pd.read_csv(io.StringIO(text))
            df.columns = [str(c).strip() for c in df.columns]
            df = df.rename(columns={"txId": "tx_id", "Time step": "time_step", "timestep": "time_step"})
            missing = [c for c in FEATURES if c not in df.columns]
            if missing:
                raise ScoreInputError(
                    f"{len(missing)} feature columns missing (e.g. {', '.join(missing[:3])}); "
                    "expected local_1..local_93 and agg_1..agg_72")
        else:
            df = pd.read_csv(io.StringIO(text), header=None)
            if df.shape[1] < 2 + len(FEATURES):
                raise ScoreInputError(
                    f"rows have {df.shape[1]} columns; the Elliptic layout is txId, time step, then 165 features")
            df = df.iloc[:, : 2 + len(FEATURES)]
            df.columns = ["tx_id", "time_step", *FEATURES]
    except pd.errors.ParserError as e:
        raise ScoreInputError(f"could not parse CSV: {e}") from e
    if len(df) > MAX_ROWS:
        raise ScoreInputError(f"{len(df):,} rows; the limit is {MAX_ROWS:,} per upload")
    feats = df[FEATURES].apply(pd.to_numeric, errors="coerce")
    bad = feats.isna().any(axis=1)
    if bad.any():
        rows = (np.flatnonzero(bad.to_numpy())[:5] + 1).tolist()
        raise ScoreInputError(f"non-numeric or empty feature values in row(s) {rows}")
    df = df.reset_index(drop=True)
    blank = pd.Series(np.nan, index=df.index)
    out = pd.DataFrame({
        "tx_id": pd.to_numeric(df["tx_id"], errors="coerce") if "tx_id" in df else blank,
        "time_step": pd.to_numeric(df["time_step"], errors="coerce") if "time_step" in df else blank,
    })
    return pd.concat([out, feats.reset_index(drop=True)], axis=1)


def _opt_int(v) -> int | None:
    return None if v is None or pd.isna(v) else int(v)


def score_frame(frame: pd.DataFrame, xgb, rf, explainer, top: int = 3) -> list[dict]:
    """XGBoost + random forest probability and the top SHAP reasons per row."""
    X = frame[FEATURES].to_numpy(np.float32)
    p_xgb = xgb.predict_proba(X)[:, 1]
    p_rf = rf.predict_proba(X)[:, 1] if rf is not None else np.full(len(X), np.nan)
    sv = explainer.shap_values(X) if explainer is not None else None
    rows = []
    for i in range(len(X)):
        step = _opt_int(frame["time_step"].iat[i])
        reasons = []
        if sv is not None:
            order = np.argsort(-np.abs(sv[i]))[:top]
            reasons = [{"feature": FEATURES[j], "shap": round(float(sv[i][j]), 4),
                        "value": round(float(X[i][j]), 4)} for j in order]
        rows.append({
            "row": i + 1,
            "tx_id": _opt_int(frame["tx_id"].iat[i]),
            "time_step": step,
            "window": window_of(step),
            "in_sample": in_sample(step),
            "xgb": round(float(p_xgb[i]), 4),
            "rf": None if np.isnan(p_rf[i]) else round(float(p_rf[i]), 4),
            "reasons": reasons,
        })
    return rows


def sample_csv(df: pd.DataFrame, n: int, label: str, seed: int) -> str:
    """Real dataset rows from the test window in the raw Elliptic layout."""
    pool = df[df["time_step"].isin(TEST_STEPS)]
    if label != "any":
        pool = pool[pool["label"] == {"illicit": 1, "licit": 0, "unknown": -1}[label]]
    pick = pool.sample(min(n, len(pool)), random_state=seed)
    buf = io.StringIO()
    pick[["tx_id", "time_step", *FEATURES]].to_csv(buf, header=False, index=False)
    return buf.getvalue()
