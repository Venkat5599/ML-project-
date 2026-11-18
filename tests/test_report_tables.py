"""Section 5 of the report is rendered from metrics and must not go stale."""
import json

import pytest

from experiments import report_tables as rt


def test_committed_report_matches_metrics():
    assert rt.main(["--check"]) == 0


def test_every_block_present_once():
    text = rt.REPORT.read_text()
    for name in rt.BLOCKS:
        assert text.count(f"<!-- metrics:{name} -->") == 1
        assert text.count(f"<!-- /metrics:{name} -->") == 1


def test_sync_replaces_a_tampered_cell():
    text = rt.REPORT.read_text()
    tampered = text.replace("| **xgb + gnn blend** | 0.956", "| **xgb + gnn blend** | 0.111", 1)
    assert tampered != text
    assert rt.sync(tampered) == text


def test_missing_block_is_an_error():
    with pytest.raises(ValueError, match="no <!-- metrics:"):
        rt.sync("no markers here")


def test_best_rows_are_bolded(tmp_path):
    for _, stem in rt.FINAL:
        m = {"precision": .5, "recall": .5, "f1": .5, "avg_precision": .5, "roc_auc": .5,
             "precision@100": .5, "recall@100": .5}
        if stem == "final_svm":
            m |= {"avg_precision": .9}
        (tmp_path / f"{stem}.json").write_text(json.dumps({"test": m}))
    lines = rt.table_final(tmp_path).splitlines()
    svm = next(line for line in lines if "SVM" in line)
    assert svm.startswith("| **SVM (rbf)**") and "**0.900**" in svm
