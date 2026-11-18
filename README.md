# ChainSleuth AML

Temporal, graph-aware hybrid ML framework for detecting suspicious Bitcoin
transactions in the Elliptic dataset. Course project - see `SPEC.md` for the
evaluation contract, split policy, and framing rules.

## Quickstart

```bash
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m experiments.download_data    # ~700MB, HuggingFace mirror, no auth
python -m experiments.eda              # figures + stats -> results/
python -m experiments.baselines        # default models on validation slice
python -m experiments.anomaly          # isolation forest + autoencoder
python -m experiments.tune --trials 30 # Optuna (add --models tuned_xgboost etc.)
python -m experiments.evaluate         # final test-window evaluation + ablations
python -m experiments.graph_features   # NetworkX topology features
python -m experiments.graph_models     # GraphSAGE (CUDA if present, else CPU)
python -m experiments.hybrid           # weighted/stacked ensemble + calibration
python -m experiments.export_site_data # results/metrics -> website/lib/dash/real.ts
python -m experiments.report_tables    # results/metrics -> REPORT.md section-5 tables
pytest tests/
```

To rebuild `report/ChainSleuth_AML_Report.docx` from `REPORT.md`, install
pandoc (or `pip install pypandoc_binary`, which bundles it) and run
`python -m experiments.build_report`.

The scripts pick CUDA when PyTorch can see a GPU and fall back to CPU otherwise.
Force a device with `CHAINSLEUTH_DEVICE=cpu` (or `cuda`). The backend only
needs `evaluate`, `graph_features` and `hybrid` to have run: together they
write `models/xgboost.joblib` and `data/processed/test_scores.parquet`.

**macOS note.** The XGBoost wheel links against `libomp`, which macOS does not
ship. Without Homebrew, borrow the copy scikit-learn bundles:

```bash
SP=$(python -c "import site; print(site.getsitepackages()[0])")
cp "$SP/sklearn/.dylibs/libomp.dylib" "$SP/xgboost/lib/"
install_name_tool -add_rpath @loader_path "$SP/xgboost/lib/libxgboost.dylib"
codesign -f -s - "$SP/xgboost/lib/libxgboost.dylib"
```

## Running the apps (local only)

```bash
python -m uvicorn backend.main:app --port 8000   # FastAPI backend, needed by both UIs

# investigation app -> http://localhost:3001
cd frontend && bun install && bun dev --port 3001

# project site + investigation console -> http://localhost:4430 (console at /dashboard/)
cd website && bun install && bun dev
```

`./run_app.sh` (macOS/Linux) or `run_app.bat` (Windows) starts the backend and
the `frontend/` app together.

The console at `/dashboard/` reads everything live from the backend: the alert
queue is the calibrated hybrid ranking of the 67,504 test-window transactions (labelled and unknown),
SHAP reasons come from the tuned XGBoost model, and the flow canvas draws the
real directed neighbourhood from the edge list. Analyst actions (assign, clear,
escalate, cases, notes) persist in `data/processed/workflow.sqlite`. The
**Score** page runs the trained models directly: look up any of the 203,769
transaction ids, or upload a CSV of Elliptic feature rows (up to 5,000; a
button pulls real test-window rows to try it with) and download the scored
results. Scores for labelled rows from steps 1-34 are flagged as in-sample,
because the saved models were fit on them. Delete `workflow.sqlite`
file, or use **Settings -> Reset workspace**, to start over. The model and
time-step pages are built from `results/metrics` and render without the
backend. Point the console at another backend with `NEXT_PUBLIC_API_URL`, and
allow extra origins on the backend with `CHAINSLEUTH_ORIGINS` (comma-separated).

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
| `experiments/graph_models.py` | GraphSAGE (CUDA or CPU): val early-stop, fixed-epoch refit |
| `experiments/hybrid.py` | weight-tuned + stacked + calibrated ensemble, writes `test_scores.parquet` |
| `experiments/export_site_data.py` | regenerates the console's `website/lib/dash/real.ts` from `results/metrics` |
| `backend/main.py` | FastAPI: alerts, tx details, SHAP, directed flow graph, console endpoints |
| `backend/workflow.py` | SQLite store for analyst actions: statuses, cases, notes, activity, settings |
| `backend/scoring.py` | scores any tx id or an uploaded Elliptic CSV with the saved models, flags in-sample rows |
| `frontend/` | Next.js app: alert table + investigation canvas |
| `website/` | Next.js static site + `/dashboard` investigation console (live backend data) |
| `run_app.sh` / `run_app.bat` | one-click local launch (backend + frontend) |
| `experiments/report_tables.py` | renders REPORT.md's section-5 tables from metrics (`--check` = stale test) |
| `experiments/build_report.py` | REPORT.md -> `ChainSleuth_AML_Report.docx` via pandoc |
| `report/REPORT.md` | the evaluation report (section-5 tables generated) |
| `report/REPRODUCTION.md` | CPU re-run vs. the committed CUDA metrics |
| `tests/` | leakage, metrics, workflow, backend API and site-export tests (`pytest tests/`) |

Rule of thumb: scripts read from `data/processed/` and write to
`results/metrics/` + `results/figures/`. Nothing touches the raw CSVs except
`download_data` and `data.py`.
