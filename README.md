# ChainSleuth AML

Temporal, graph-aware hybrid ML framework for detecting suspicious Bitcoin
transactions in the Elliptic dataset. Course project - see `SPEC.md` for the
evaluation contract, split policy, and framing rules.

## Quickstart

```bash
pip install -r requirements.txt
python -m experiments.download_data    # ~700MB, HuggingFace mirror, no auth
python -m experiments.eda              # figures + stats -> results/
python -m experiments.baselines        # default models on validation slice
python -m experiments.anomaly          # isolation forest + autoencoder
python -m experiments.tune --trials 30 # Optuna (add --models tuned_xgboost etc.)
python -m experiments.evaluate         # final test-window evaluation + ablations
python -m experiments.graph_features   # NetworkX topology features
python -m experiments.graph_models     # GraphSAGE on GPU
python -m experiments.hybrid           # weighted/stacked ensemble + calibration
pytest tests/

# investigation app (local only)
python -m uvicorn backend.main:app --port 8000        # FastAPI backend
cd frontend && bun install && bun dev --port 3001     # Next.js frontend -> http://localhost:3001
```

## Protocol in one line

Train on time steps 1-29, tune on 30-34, evaluate once on 35-49. Unknown labels
are never used as ground truth. Results are suspicion rankings, not criminality.

## Codebase map

Every file, in the order data flows through it:

| file / dir | what it does |
|---|---|
| `chainsleuth/config.py` | paths, seeds, split constants (train 1-29 / val 30-34 / test 35-49) |
| `chainsleuth/data.py` | loads raw Elliptic CSVs, builds the joined dataset parquet |
| `chainsleuth/splits.py` | temporal masks + the feature-column list (165 features) |
| `chainsleuth/metrics.py` | evaluation: F1, AP, ROC-AUC, Precision/Recall@K |
| `chainsleuth/graph.py` | builds the PyG `Data` object (nodes, edges, masks) for the GNN |
| `experiments/download_data.py` | downloads the dataset (HuggingFace mirror, no login needed) |
| `experiments/eda.py` | exploratory analysis -> `results/figures/` |
| `experiments/baselines.py` | quick untuned model comparison |
| `experiments/tune.py` | Optuna hyperparameter tuning (validation AP objective) |
| `experiments/evaluate.py` | retrains tuned models once, writes test metrics + ablations |
| `experiments/anomaly.py` | Isolation Forest + autoencoder (fit on licit only) |
| `experiments/graph_features.py` | NetworkX topology features (degree, PageRank, ...) |
| `experiments/graph_models.py` | GraphSAGE on GPU: val early-stop, fixed-epoch refit |
| `experiments/hybrid.py` | weight-tuned + stacked + calibrated ensemble |
| `backend/main.py` | FastAPI: alerts, tx details, SHAP, directed flow graph |
| `frontend/` | Next.js app: alert table + investigation canvas |
| `run_app.bat` | one-click local launch (backend + frontend) |
| `report/REPORT.md` | the evaluation report (all numbers generated) |
| `tests/` | leakage + metrics unit tests (`pytest tests/`) |

Rule of thumb: scripts read from `data/processed/` and write to
`results/metrics/` + `results/figures/`. Nothing touches the raw CSVs except
`download_data` and `data.py`.
