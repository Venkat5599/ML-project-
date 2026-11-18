"""Device selection and split constants."""
from chainsleuth import config
from chainsleuth.config import TEST_STEPS, TRAIN_STEPS, VAL_STEPS


def test_split_windows_cover_all_49_steps_without_overlap():
    steps = list(TRAIN_STEPS) + list(VAL_STEPS) + list(TEST_STEPS)
    assert steps == list(range(1, 50))


def test_device_override(monkeypatch):
    monkeypatch.setenv("CHAINSLEUTH_DEVICE", "cpu")
    assert config.torch_device() == "cpu"
    assert config.xgb_device() == "cpu"


def test_xgb_never_gets_mps(monkeypatch):
    # XGBoost has no Metal backend; an mps torch device must map to cpu
    monkeypatch.setenv("CHAINSLEUTH_DEVICE", "mps")
    assert config.torch_device() == "mps"
    assert config.xgb_device() == "cpu"


def test_device_autodetect_returns_known_value(monkeypatch):
    monkeypatch.delenv("CHAINSLEUTH_DEVICE", raising=False)
    assert config.torch_device() in {"cuda", "cpu"}
