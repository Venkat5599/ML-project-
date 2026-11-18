"""Site-data export: metrics JSON -> website/lib/dash/real.ts."""
import json

import pandas as pd
import pytest

from experiments import export_site_data as ex


def _metric(p=0.5):
    return {"test": {"precision": p, "recall": 0.4, "f1": 0.44, "avg_precision": 0.6,
                     "roc_auc": 0.9, "precision@100": 1.0, "n_eval": 100, "n_positive": 7}}


@pytest.fixture()
def metrics_dir(tmp_path):
    for _, stem, *_ in ex.MODELS:
        (tmp_path / f"{stem}.json").write_text(json.dumps(_metric()))
    return tmp_path


def test_every_model_row_has_the_console_fields(metrics_dir):
    rows = ex.model_rows(metrics_dir)
    assert len(rows) == len(ex.MODELS)
    assert set(rows[0]) == {"key", "name", "short", "family", "p", "r", "f1", "ap",
                            "auc", "p100", "nEval", "nPos"}
    assert rows[0]["nPos"] == 7


def test_missing_metrics_file_is_loud(metrics_dir):
    (metrics_dir / "final_svm.json").unlink()
    with pytest.raises(FileNotFoundError, match="final_svm"):
        ex.model_rows(metrics_dir)


def test_weights_sorted_and_named(metrics_dir):
    assert ex.weight_rows(metrics_dir) is None
    payload = _metric() | {"weights": {"xgb": 0.4, "ae": 0.5, "iso": 0.1}}
    (metrics_dir / "final_ensemble_weighted.json").write_text(json.dumps(payload))
    assert ex.weight_rows(metrics_dir) == [
        {"name": "Autoencoder", "weight": 0.5},
        {"name": "XGBoost", "weight": 0.4},
        {"name": "Isolation forest", "weight": 0.1},
    ]


def test_per_step_and_eda_counts():
    df = pd.DataFrame({"time_step": [1, 1, 1, 2], "label": [1, 0, -1, -1]})
    assert ex.per_step(df) == [
        {"step": 1, "total": 3, "labelled": 2, "illicit": 1},
        {"step": 2, "total": 1, "labelled": 0, "illicit": 0},
    ]
    assert ex.eda_block(df, 9) == {"n_total": 4, "n_illicit": 1, "n_licit": 1,
                                   "n_unknown": 2, "n_time_steps": 2, "n_edges": 9}


def test_committed_metrics_export_cleanly():
    rows = ex.model_rows()
    xgb = next(r for r in rows if r["key"] == "xgboost")
    assert 0 < xgb["ap"] <= 1 and xgb["nEval"] > 0


def test_render_is_a_ts_module():
    text = ex.render([{"key": "x"}], [{"step": 1}], {"n_total": 1}, None)
    assert "export const MODELS" in text and "export const WEIGHTS" in text
    assert "= null;" in text
