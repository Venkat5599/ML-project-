"""Analyst workflow store: statuses, cases, notes, activity, settings."""
import pytest

from backend import workflow as wf


@pytest.fixture()
def con(tmp_path, monkeypatch):
    monkeypatch.setenv("CHAINSLEUTH_DB", str(tmp_path / "wf.sqlite"))
    with wf.connect() as c:
        yield c


def test_untouched_alert_has_no_state(con):
    assert wf.alert_states(con) == {}
    assert wf.cases(con) == []
    assert wf.activity(con) == []


def test_assign_moves_new_to_reviewing(con):
    wf.assign(con, [11, 12], "Ana")
    st = wf.alert_states(con)
    assert st[11] == {"status": "reviewing", "assignee": "Ana", "caseId": None, "notes": []}
    assert wf.activity(con)[0]["text"] == "took 2 alerts for review"


def test_assign_keeps_cleared_status(con):
    wf.set_status(con, [5], "cleared", "Ana")
    wf.assign(con, [5], "Bo")
    assert wf.alert_states(con)[5]["status"] == "cleared"
    assert wf.alert_states(con)[5]["assignee"] == "Bo"


def test_set_status_rejects_unknown(con):
    with pytest.raises(wf.WorkflowError):
        wf.set_status(con, [1], "deleted", "Ana")


def test_escalate_to_new_case_links_both_ways(con):
    cid = wf.escalate(con, [7, 8], "new", "Ana", "Peel chain")
    assert cid == "CS-1001"
    (case,) = wf.cases(con)
    assert case["title"] == "Peel chain" and case["txs"] == [7, 8]
    st = wf.alert_states(con)
    assert st[7]["status"] == "escalated" and st[7]["caseId"] == cid


def test_escalate_into_closed_case_reopens_it(con):
    cid = wf.create_case(con, "old", "Ana")
    wf.set_case_status(con, cid, "closed", "Ana")
    wf.escalate(con, [3], cid, "Ana")
    assert wf.cases(con)[0]["status"] == "open"


def test_escalate_to_missing_case_fails(con):
    with pytest.raises(wf.WorkflowError):
        wf.escalate(con, [3], "CS-9999", "Ana")


def test_case_ids_increase(con):
    a = wf.create_case(con, "a", "Ana")
    b = wf.create_case(con, "b", "Ana")
    assert (a, b) == ("CS-1001", "CS-1002")


def test_remove_from_case_reverts_alert(con):
    cid = wf.escalate(con, [4], "new", "Ana", "x")
    wf.remove_from_case(con, cid, 4, "Ana")
    assert wf.cases(con)[0]["txs"] == []
    assert wf.alert_states(con)[4] == {"status": "reviewing", "assignee": "Ana", "caseId": None, "notes": []}


def test_notes_on_tx_and_case(con):
    cid = wf.create_case(con, "c", "Ana")
    wf.add_note(con, "Ana", "  looks like a mixer  ", tx_id=9)
    wf.add_note(con, "Bo", "check step 41", case_id=cid)
    assert wf.alert_states(con)[9]["notes"][0]["text"] == "looks like a mixer"
    assert wf.alert_states(con)[9]["status"] == "new"
    assert wf.cases(con)[0]["notes"][0]["by"] == "Bo"
    with pytest.raises(wf.WorkflowError):
        wf.add_note(con, "Ana", "   ", tx_id=9)


def test_settings_defaults_and_validation(con):
    assert wf.settings(con)["threshold"] == 0.5
    assert wf.update_settings(con, {"threshold": 0.7, "analyst": "Ana"})["analyst"] == "Ana"
    with pytest.raises(wf.WorkflowError):
        wf.update_settings(con, {"threshold": 2})
    with pytest.raises(wf.WorkflowError):
        wf.update_settings(con, {"colour": "red"})


def test_reset_keeps_settings(con):
    wf.update_settings(con, {"analyst": "Ana"})
    wf.escalate(con, [1], "new", "Ana", "x")
    wf.reset(con)
    assert wf.cases(con) == [] and wf.alert_states(con) == {} and wf.activity(con) == []
    assert wf.settings(con)["analyst"] == "Ana"


def test_touched_ids(con):
    wf.assign(con, [1], "Ana")
    wf.add_note(con, "Ana", "n", tx_id=2)
    wf.escalate(con, [3], "new", "Ana", "x")
    assert wf.touched_tx_ids(con) == {1, 2, 3}
