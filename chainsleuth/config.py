"""Central configuration: paths, seeds, split policy, dataset URLs."""
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_RAW = PROJECT_ROOT / "data" / "raw"
DATA_PROCESSED = PROJECT_ROOT / "data" / "processed"
RESULTS_DIR = PROJECT_ROOT / "results"
FIGURES_DIR = RESULTS_DIR / "figures"
METRICS_DIR = RESULTS_DIR / "metrics"
MODELS_DIR = PROJECT_ROOT / "models"
REPORT_DIR = PROJECT_ROOT / "report"

for _d in (DATA_RAW, DATA_PROCESSED, FIGURES_DIR, METRICS_DIR, MODELS_DIR, REPORT_DIR):
    _d.mkdir(parents=True, exist_ok=True)

SEED = 42

# Elliptic time-step split (1-49 total; paper uses 1-34 train / 35-49 test).
# We hold out 30-34 as a tuning-only validation slice inside the train window.
TRAIN_STEPS = range(1, 30)
VAL_STEPS = range(30, 35)
TEST_STEPS = range(35, 50)

# Top-K alert budgets evaluated on the test set
ALERT_KS = (50, 100, 250)

# HuggingFace mirror of the Elliptic dataset (no auth required)
HF_BASE = "https://huggingface.co/datasets/yhoma/elliptic-bitcoin-dataset/resolve/main"
FILES = {
    "features": "elliptic_txs_features.csv",
    "classes": "elliptic_txs_classes.csv",
    "edgelist": "elliptic_txs_edgelist.csv",
}

# elliptic_txs_features.csv has no header:
# col 0 = txId, col 1 = time step (1-49), cols 2-94 = 93 local features,
# cols 95-166 = 72 aggregated (one-hop neighbour) features.
N_LOCAL_FEATURES = 93
N_AGG_FEATURES = 72
