"""Analyst workflow state for the investigation console.

Model scores are read-only (data/processed/test_scores.parquet). Everything an
analyst *does* to an alert - assign, clear, escalate, note, group into cases -
lives here, in a small SQLite file next to the processed data. Delete the file
to start over; the scores are untouched.
"""
from __future__ import annotations

import json
import os
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

from chainsleuth.config import DATA_PROCESSED

STATUSES = ("new", "reviewing", "escalated", "cleared")
CASE_STATUSES = ("open", "in review", "closed")
DEFAULT_SETTINGS = {
    "threshold": 0.5,
    "budget": 100,
    "analyst": "Analyst",
    "notifyEscalations": True,
    "autoAssign": False,
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS alert_state (
    tx_id    INTEGER PRIMARY KEY,
    status   TEXT NOT NULL DEFAULT 'new',
    assignee TEXT,
    case_id  TEXT
);
CREATE TABLE IF NOT EXISTS cases (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'open',
    owner      TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS case_txs (
    case_id TEXT NOT NULL,
    tx_id   INTEGER NOT NULL,
    PRIMARY KEY (case_id, tx_id)
);
CREATE TABLE IF NOT EXISTS notes (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    tx_id   INTEGER,
    case_id TEXT,
    at      INTEGER NOT NULL,
    author  TEXT NOT NULL,
    text    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS activity (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    at   INTEGER NOT NULL,
    who  TEXT NOT NULL,
    text TEXT NOT NULL,
    tone TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


class WorkflowError(ValueError):
    """Bad input from the client (unknown status, missing case, ...)."""


def db_path() -> Path:
    return Path(os.environ.get("CHAINSLEUTH_DB", DATA_PROCESSED / "workflow.sqlite"))


def now_ms() -> int:
    return int(time.time() * 1000)


@contextmanager
def connect():
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    try:
        yield con
        con.commit()
    finally:
        con.close()


# ------------------------------------------------------------------ reads
def settings(con) -> dict:
    out = dict(DEFAULT_SETTINGS)
    for r in con.execute("SELECT key, value FROM settings"):
        out[r["key"]] = json.loads(r["value"])
    return out


def alert_states(con) -> dict[int, dict]:
    states = {
        r["tx_id"]: {"status": r["status"], "assignee": r["assignee"],
                     "caseId": r["case_id"], "notes": []}
        for r in con.execute("SELECT * FROM alert_state")
    }
    for r in con.execute("SELECT * FROM notes WHERE tx_id IS NOT NULL ORDER BY at"):
        states.setdefault(r["tx_id"], {"status": "new", "assignee": None,
                                       "caseId": None, "notes": []})
        states[r["tx_id"]]["notes"].append({"at": r["at"], "by": r["author"], "text": r["text"]})
    return states


def cases(con) -> list[dict]:
    txs: dict[str, list[int]] = {}
    for r in con.execute("SELECT case_id, tx_id FROM case_txs ORDER BY rowid"):
        txs.setdefault(r["case_id"], []).append(r["tx_id"])
    notes: dict[str, list[dict]] = {}
    for r in con.execute("SELECT * FROM notes WHERE case_id IS NOT NULL ORDER BY at"):
        notes.setdefault(r["case_id"], []).append({"at": r["at"], "by": r["author"], "text": r["text"]})
    return [
        {"id": r["id"], "title": r["title"], "status": r["status"], "owner": r["owner"],
         "createdAt": r["created_at"], "txs": txs.get(r["id"], []), "notes": notes.get(r["id"], [])}
        for r in con.execute("SELECT * FROM cases ORDER BY created_at DESC, id DESC")
    ]


def activity(con, limit: int = 60) -> list[dict]:
    return [
        {"at": r["at"], "who": r["who"], "text": r["text"], "tone": r["tone"]}
        for r in con.execute("SELECT * FROM activity ORDER BY id DESC LIMIT ?", (limit,))
    ]


def touched_tx_ids(con) -> set[int]:
    ids = {r[0] for r in con.execute("SELECT tx_id FROM alert_state")}
    ids |= {r[0] for r in con.execute("SELECT tx_id FROM case_txs")}
    ids |= {r[0] for r in con.execute("SELECT tx_id FROM notes WHERE tx_id IS NOT NULL")}
    return ids


# ------------------------------------------------------------------ writes
def log(con, who: str, text: str, tone: str = "info") -> None:
    con.execute("INSERT INTO activity (at, who, text, tone) VALUES (?, ?, ?, ?)",
                (now_ms(), who, text, tone))


def _state_row(con, tx_id: int) -> dict:
    r = con.execute("SELECT * FROM alert_state WHERE tx_id = ?", (tx_id,)).fetchone()
    if r is None:
        return {"status": "new", "assignee": None, "case_id": None}
    return {"status": r["status"], "assignee": r["assignee"], "case_id": r["case_id"]}


def _put_state(con, tx_id: int, **kv) -> None:
    cur = _state_row(con, tx_id)
    cur.update(kv)
    con.execute(
        "INSERT INTO alert_state (tx_id, status, assignee, case_id) VALUES (?, ?, ?, ?) "
        "ON CONFLICT(tx_id) DO UPDATE SET status=excluded.status, "
        "assignee=excluded.assignee, case_id=excluded.case_id",
        (tx_id, cur["status"], cur["assignee"], cur["case_id"]),
    )


def _plural(ids: list[int], one: str, many: str) -> str:
    return one.format(ids[0]) if len(ids) == 1 else many.format(len(ids))


def assign(con, ids: list[int], who: str) -> None:
    if not ids:
        raise WorkflowError("no transactions given")
    for tx in ids:
        cur = _state_row(con, tx)
        _put_state(con, tx, assignee=who,
                   status="reviewing" if cur["status"] == "new" else cur["status"])
    log(con, who, _plural(ids, "took tx {} for review", "took {} alerts for review"))


def set_status(con, ids: list[int], status: str, who: str) -> None:
    if status not in STATUSES:
        raise WorkflowError(f"unknown status {status!r}")
    if not ids:
        raise WorkflowError("no transactions given")
    for tx in ids:
        cur = _state_row(con, tx)
        _put_state(con, tx, status=status, assignee=cur["assignee"] or who)
    verb = {"cleared": "cleared", "new": "reopened", "reviewing": "started reviewing",
            "escalated": "escalated"}[status]
    tone = {"cleared": "ok", "escalated": "bad"}.get(status, "info")
    log(con, who, _plural(ids, f"{verb} tx {{}}", f"{verb} {{}} alerts"), tone)


def _next_case_id(con) -> str:
    nums = [int(r[0].split("-")[1]) for r in con.execute("SELECT id FROM cases")
            if r[0].startswith("CS-") and r[0].split("-")[1].isdigit()]
    return f"CS-{max([1000, *nums]) + 1}"


def create_case(con, title: str, who: str, txs: list[int] | None = None) -> str:
    title = title.strip()
    if not title:
        raise WorkflowError("case title is empty")
    cid = _next_case_id(con)
    con.execute("INSERT INTO cases (id, title, status, owner, created_at) VALUES (?, ?, 'open', ?, ?)",
                (cid, title, who, now_ms()))
    for tx in txs or []:
        con.execute("INSERT OR IGNORE INTO case_txs (case_id, tx_id) VALUES (?, ?)", (cid, tx))
    log(con, who, f"opened {cid}", "warn")
    return cid


def _require_case(con, cid: str):
    r = con.execute("SELECT * FROM cases WHERE id = ?", (cid,)).fetchone()
    if r is None:
        raise WorkflowError(f"no case {cid}")
    return r


def escalate(con, ids: list[int], case_id: str, who: str, title: str | None = None) -> str:
    if not ids:
        raise WorkflowError("no transactions given")
    if case_id == "new":
        case_id = create_case(con, title or f"Case from tx {ids[0]}", who)
    else:
        r = _require_case(con, case_id)
        if r["status"] == "closed":
            con.execute("UPDATE cases SET status = 'open' WHERE id = ?", (case_id,))
    for tx in ids:
        cur = _state_row(con, tx)
        _put_state(con, tx, status="escalated", case_id=case_id, assignee=cur["assignee"] or who)
        con.execute("INSERT OR IGNORE INTO case_txs (case_id, tx_id) VALUES (?, ?)", (case_id, tx))
    log(con, who, _plural(ids, f"escalated tx {{}} to {case_id}", f"escalated {{}} alerts to {case_id}"), "bad")
    return case_id


def add_note(con, who: str, text: str, tx_id: int | None = None, case_id: str | None = None) -> None:
    text = text.strip()
    if not text:
        raise WorkflowError("note is empty")
    if case_id is not None:
        _require_case(con, case_id)
    con.execute("INSERT INTO notes (tx_id, case_id, at, author, text) VALUES (?, ?, ?, ?, ?)",
                (tx_id, case_id, now_ms(), who, text))
    log(con, who, f"noted on {case_id}" if case_id else f"noted on tx {tx_id}")


def set_case_status(con, case_id: str, status: str, who: str) -> None:
    if status not in CASE_STATUSES:
        raise WorkflowError(f"unknown case status {status!r}")
    _require_case(con, case_id)
    con.execute("UPDATE cases SET status = ? WHERE id = ?", (status, case_id))
    verb = {"closed": "closed", "open": "reopened", "in review": "moved to review"}[status]
    log(con, who, f"{verb} {case_id}", "ok" if status == "closed" else "info")


def remove_from_case(con, case_id: str, tx_id: int, who: str) -> None:
    _require_case(con, case_id)
    con.execute("DELETE FROM case_txs WHERE case_id = ? AND tx_id = ?", (case_id, tx_id))
    cur = _state_row(con, tx_id)
    if cur["case_id"] == case_id:
        _put_state(con, tx_id, case_id=None, status="reviewing")
    log(con, who, f"removed tx {tx_id} from {case_id}")


def update_settings(con, patch: dict) -> dict:
    unknown = set(patch) - set(DEFAULT_SETTINGS)
    if unknown:
        raise WorkflowError(f"unknown settings: {sorted(unknown)}")
    if "threshold" in patch and not 0 <= float(patch["threshold"]) <= 1:
        raise WorkflowError("threshold must be in [0, 1]")
    if "budget" in patch and int(patch["budget"]) < 1:
        raise WorkflowError("budget must be >= 1")
    for k, v in patch.items():
        con.execute("INSERT INTO settings (key, value) VALUES (?, ?) "
                    "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (k, json.dumps(v)))
    return settings(con)


def reset(con) -> None:
    """Wipe analyst state (cases, notes, statuses, activity). Settings survive."""
    for table in ("alert_state", "cases", "case_txs", "notes", "activity"):
        con.execute(f"DELETE FROM {table}")
