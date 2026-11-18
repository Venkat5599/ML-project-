<div align="center">

# CHAINSLEUTH AML

### A temporal, graph-aware model that ranks Bitcoin transactions by suspicion and shows its reasons.

![Tests](https://img.shields.io/badge/tests-72%20passing-2ecc71)
![Python](https://img.shields.io/badge/python-3.12-3776ab)
![Stack](https://img.shields.io/badge/XGBoost%20·%20GraphSAGE%20·%20FastAPI%20·%20Next.js%2016-14151a)
![Runs](https://img.shields.io/badge/runs-locally-555)

**[ Run it ↓ ](#run-it-locally)** · **[ Architecture ↓ ](#architecture)** · **[ Results ↓ ](#results-and-supporting-records)** · **[ Honesty table ↓ ](#whats-real-vs-pending--the-honesty-table)**

</div>

ChainSleuth trains on the Elliptic Bitcoin dataset (203,769 transactions, 234,355 flows, 49 time steps). The split is strictly chronological: models learn on steps 1–29, are tuned on 30–34 and are scored **once** on 35–49. The result is a ranked queue, and every alert in it carries its SHAP reasons and its fund-flow neighbourhood. A local FastAPI backend serves that ranking to an investigation console, where an analyst can assign, clear and escalate alerts into cases, or score any transaction (or an uploaded CSV of them) with the trained models. Unknown labels are never treated as licit. They are scored, ranked and left for a person to decide.

```
honest split ≠ random split          AP 0.801 vs 0.986 on the same XGBoost
a flag       ≠ a crime               the output is a suspicion ranking for review
unknown      ≠ licit                 157,205 unlabelled rows are never ground truth
```

## Live status

Everything runs on your own machine; nothing is hosted.

| Surface | Status | The evidence |
|---|---|---|
| Pipeline (download → tune → evaluate → ensemble) | Runs end to end, CUDA or CPU | CPU re-run vs the committed CUDA metrics in [`report/REPRODUCTION.md`](report/REPRODUCTION.md) |
| Backend API | 20 routes, local only | `backend/main.py`; contract covered by `tests/test_backend.py` and `tests/test_scoring.py` |
| Investigation console (`website/` → `/dashboard/`) | Live data, no mock state | Alerts, cases, flow graph and scoring all read the backend; analyst actions persist in SQLite |
| Investigation app (`frontend/`) | Builds and reads the same API | `bun run build` in `frontend/` |
| Report | Section-5 tables generated from metrics | `python -m experiments.report_tables --check` → `report tables up to date` |
| Tests | 72 passing | `pytest tests/` |
| Hosted deployment | None | Local project; see [How I'd deploy it](#how-id-deploy-it) |

## The 20-second pitch

Most fraud models on Elliptic are scored on a random split, which lets the model see the future. Run the same XGBoost on a random split and it posts AP 0.986. Split it by time, the way it would meet new data, and it drops to 0.801. **ChainSleuth reports the 0.801.**

On top of that honest number it does three things a bare classifier doesn't:

```
transaction ──► 5 tabular models + 2 anomaly detectors + GraphSAGE
                      │
                      ▼
          weights tuned on steps 30–34 only ──► isotonic calibration
                      │
                      ▼
          ranked queue (test steps 35–49, labelled AND unlabelled)
                      │
         ┌────────────┼────────────────┐
         ▼            ▼                ▼
   SHAP reasons   directed flow     analyst triage
   per alert      neighbourhood     (assign · clear · escalate · cases)
```

It also hands the trained model to the analyst directly: type any transaction id, or upload rows as CSV, and the console scores them on the spot. Labelled rows from steps 1–34 get a warning, because the saved models were fit on exactly those rows.

## Table of contents

- [Live status](#live-status)
- [The 20-second pitch](#the-20-second-pitch)
- [See it in one command](#-see-it-in-one-command)
- [Verify every claim in one command](#verify-every-claim-in-one-command)
- [What ChainSleuth is NOT](#what-chainsleuth-is-not)
- [The problem I set out to solve](#the-problem-i-set-out-to-solve)
- [What I built](#what-i-built)
- [Architecture](#architecture)
- [The pipeline, step by step](#the-pipeline-step-by-step)
- [Where the guarantee is enforced](#where-the-guarantee-is-enforced)
- [What the evaluation measures](#what-the-evaluation-measures)
- [Engineering decisions & the traps that taught me something](#engineering-decisions--the-traps-that-taught-me-something)
- [What's real vs pending — the honesty table](#whats-real-vs-pending--the-honesty-table)
- [Attack → test](#attack--test)
- [The app](#the-app)
- [Limitations](#limitations)
- [Security](#security)
- [Tech stack](#tech-stack)
- [Project layout](#project-layout)
- [Full command reference](#full-command-reference)
- [Run it locally](#run-it-locally)
- [How I'd deploy it](#how-id-deploy-it)
- [Results and supporting records](#results-and-supporting-records)
- [Tests](#tests)
- [License](#license)

## ▶ See it in one command

With the backend running (`python -m uvicorn backend.main:app --port 8000`), pull 200 real illicit transactions from the held-out window and score them with the trained models:

```
$ curl -s "127.0.0.1:8000/api/score/sample?n=200&label=illicit&seed=1" | curl -s -X POST --data-binary @- -H "content-type: text/csv" 127.0.0.1:8000/api/score/batch | jq -c "{n, n_flagged, n_in_sample}"
{"n":200,"n_flagged":159,"n_in_sample":0}
```

The same call with `label=licit` flags none of them:

```
{"n":200,"n_flagged":0,"n_in_sample":0}
```

One transaction, with the three features that moved it most:

```
$ curl -s "127.0.0.1:8000/api/score/tx/28944698?top=3" | jq -c '{tx_id, label, window, in_sample, xgb, rf, hybrid, reasons: [.reasons[] | "\(.feature) \(.shap)"]}'
{"tx_id":28944698,"label":"unknown","window":"test","in_sample":false,"xgb":0.9934,"rf":0.9129,"hybrid":1.0,"reasons":["local_53 2.0422","agg_70 1.216","local_90 -0.9724"]}
```

And the queue the console opens on:

```
$ curl -s "127.0.0.1:8000/api/console?limit=1" | jq .window
{
  "n_scored": 67504,
  "steps": [
    35,
    49
  ],
  "limit": 1,
  "above_threshold": 5379
}
```

These outputs come from the models and scores the local pipeline run wrote to `models/` and `data/processed/` (both gitignored). See the honesty table for how that run relates to the committed metrics.

## Verify every claim in one command

```
$ pytest tests/ -q
72 passed, 2 warnings in 1.72s

$ python -m experiments.report_tables --check
report tables up to date
```

The second command re-renders every table in section 5 of [`report/REPORT.md`](report/REPORT.md) from `results/metrics/` and fails if a single cell differs. The test suite runs the same check, so a report number typed by hand fails `pytest`.

## What ChainSleuth is NOT

- **Not proof of crime.** A score ranks a transaction for human review. The dataset's labels come from the vendor's attribution and cover 23% of transactions; nothing here can confirm a case without off-chain evidence.
- **Not a live chain monitor.** It works on the anonymised Elliptic snapshot. It does not read the Bitcoin network.
- **Not a random-split benchmark.** The random-split result is in the repo only to show how much it inflates the score.
- **Not hosted.** There is no deployment, no login and no multi-user server; see [Security](#security).

## The problem I set out to solve

Laundering on Bitcoin moves funds through chains of transactions faster than per-transaction rules can follow. Rule systems over-flag, and a model that is scored on a shuffled split looks far better than it will on next month's data. I wanted three things at once: a ranking that holds up when it is tested on time steps the model never saw, an explanation for every alert, and a tool an analyst could actually work a queue in, including the 77% of transactions nobody has labelled.

## What I built

- **A leakage-safe pipeline** (`chainsleuth/`, `experiments/`): chronological split, Optuna tuning on the validation window only, one final evaluation on the test window.
- **Fifteen evaluated models and experiments**: logistic regression, decision tree, random forest, XGBoost, SVM, isolation forest, autoencoder, GraphSAGE, XGBoost with graph features, an XGBoost+GNN blend, weighted/stacked/calibrated ensembles, plus random-split and top-30-feature ablations.
- **A FastAPI backend** (`backend/`) that serves the ranking, SHAP explanations, directed flow graphs, a SQLite triage workflow and on-demand scoring.
- **An investigation console** (`website/app/dashboard/`) with an alert queue, flow canvas, cases, a scoring page, model comparison and time-step pages.
- **A report** (`report/REPORT.md`, DOCX export) whose results tables are generated and tested.

## Architecture

```
 data/raw/*.csv ──► chainsleuth/data.py ──► data/processed/dataset.parquet
                                                   │
           experiments/{baselines,tune,evaluate,anomaly,graph_features,graph_models,hybrid}.py
                                                   │
                 ┌─────────────────────────────────┼──────────────────────────────┐
                 ▼                                 ▼                              ▼
         results/metrics/*.json            models/*.joblib, *.pt       data/processed/test_scores.parquet
                 │                                 │                              │
   experiments/report_tables.py                    └──────────┬───────────────────┘
   experiments/export_site_data.py                            ▼
                 │                                     backend/main.py (FastAPI)
                 ▼                                      │       │        │
     report/REPORT.md, website/lib/dash/real.ts   scoring.py  workflow.py (SQLite)
                                                        │
                                       website/ console  ·  frontend/ app
```

### Component by component

| Component | File | What it does |
|---|---|---|
| Config | `chainsleuth/config.py` | Paths, `SEED = 42`, split windows, alert budgets, CUDA/CPU device choice |
| Data | `chainsleuth/data.py` | Downloads the CSVs, joins features and labels (`1` illicit, `0` licit, `-1` unknown) |
| Splits | `chainsleuth/splits.py` | Temporal and random splits, the 165-feature list |
| Metrics | `chainsleuth/metrics.py` | P, R, F1, AP, ROC-AUC, Precision/Recall@K |
| Graph | `chainsleuth/graph.py` | PyG graph, train-only feature scaling, disjoint masks |
| Ensemble | `experiments/hybrid.py` | Component scores → val-tuned weights → isotonic calibration → `test_scores.parquet` |
| Scoring | `backend/scoring.py` | Parses uploaded CSVs, scores rows, decides in-sample status |
| Workflow | `backend/workflow.py` | Statuses, cases, notes, activity and settings in SQLite |
| Report tables | `experiments/report_tables.py` | Renders REPORT.md section 5 from metrics; `--check` mode |
| Site data | `experiments/export_site_data.py` | Writes the console's model and time-step data from metrics |

### HTTP surface

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness |
| GET | `/api/summary` | Counts of scored, illicit, licit and unknown rows in the test window |
| GET | `/api/alerts` | Ranked alerts, filterable by score, label and step |
| GET | `/api/tx/{tx_id}` | Every model score for one test-window transaction |
| GET | `/api/tx/{tx_id}/explain` | TreeSHAP contributions from the tuned XGBoost |
| GET | `/api/tx/{tx_id}/graph` | Directed 1- or 2-hop flow neighbourhood |
| GET | `/api/console` | Queue snapshot with analyst state, cases, activity, settings |
| POST | `/api/console/alerts/{assign,status,escalate}` | Triage actions on a list of ids |
| POST | `/api/console/alerts/{tx_id}/notes` | Note on an alert |
| POST | `/api/console/cases`, `/api/console/cases/{id}/{status,notes}` | Case lifecycle |
| DELETE | `/api/console/cases/{id}/txs/{tx_id}` | Unlink a transaction from a case |
| PUT | `/api/console/settings` | Threshold, review budget, analyst name |
| POST | `/api/console/reset` | Wipe analyst state; model scores are untouched |
| GET | `/api/score/tx/{tx_id}` | Score any of the 203,769 transactions with the saved models |
| POST | `/api/score/batch` | Score an uploaded CSV (up to 5,000 rows) |
| GET | `/api/score/sample` | Real test-window rows as CSV, by label |

## The pipeline, step by step

1. **Download and join.** `experiments/download_data.py` fetches the three CSVs from a HuggingFace mirror (about 700 MB, no login) and writes `dataset.parquet`.
2. **Explore.** `experiments/eda.py` writes the class, drift, separability, correlation and degree figures to `results/figures/`.
3. **Baseline.** `experiments/baselines.py` and `experiments/anomaly.py` score untuned models on validation steps 30–34. The anomaly detectors are fit on licit training rows only.
4. **Tune.** `experiments/tune.py` runs Optuna TPE with validation AP as the objective. The test window is not read.
5. **Evaluate once.** `experiments/evaluate.py` refits on steps 1–34 and scores 35–49 a single time, plus the random-split and top-30-feature ablations.
6. **Graph.** `experiments/graph_features.py` adds NetworkX topology; `experiments/graph_models.py` trains GraphSAGE with validation early stopping and refits for that exact epoch count.
7. **Combine.** `experiments/hybrid.py` normalises each component on the validation scale, tunes non-negative weights on validation, calibrates with isotonic regression, and writes scores for all 67,504 test-window transactions, labelled and unlabelled.
8. **Publish.** `report_tables.py` and `export_site_data.py` carry the new metrics into the report and the console.

## Where the guarantee is enforced

The guarantee is that no step lets test-window information into training or into the reported numbers.

| Guarantee | Module | The test that covers it |
|---|---|---|
| Train, validation and test rows never overlap, and are ordered in time | `chainsleuth/splits.py` | `test_temporal_split_disjoint_and_ordered` |
| Unknown labels never reach supervised training or evaluation | `chainsleuth/splits.py` | `test_temporal_split_excludes_unknown` |
| The feature list holds only the 165 Elliptic features, never id, step or label | `chainsleuth/splits.py` | `test_feature_cols_are_the_165_elliptic_features_only` |
| GNN masks are disjoint and never include unknown rows | `chainsleuth/graph.py` | `test_graph_masks_are_disjoint_and_never_include_unknown` |
| GNN feature scaling is fit on training rows only | `chainsleuth/graph.py` | `test_graph_scaler_is_fit_on_train_rows_only` |
| Report tables equal the metric files | `experiments/report_tables.py` | `test_committed_report_matches_metrics` |
| A score is marked in-sample only when the saved models trained on that row | `backend/scoring.py` | `test_unlabelled_or_unknown_rows_are_never_in_sample` |

## What the evaluation measures

- **Average precision (PR-AUC)** is the headline. Only 6.5% of labelled test rows are illicit, so accuracy and ROC-AUC flatter weak models.
- **Precision@K and Recall@K** for K = 50, 100, 250, because an analyst works the top of a queue, not a threshold.
- **F1, precision and recall** at the model's default threshold.
- **Batch inference time** per model.

Every number is computed on the 16,670 labelled transactions of steps 35–49, once.

## Engineering decisions & the traps that taught me something

- **`device="cuda"` was hardcoded in seven scripts.** The pipeline only ran on the original GPU laptop. Device choice now lives in `chainsleuth/config.py` (`torch_device()`, `xgb_device()`), falls back to CPU, and can be forced with `CHAINSLEUTH_DEVICE`. XGBoost never gets `mps`, since it has no Metal backend.
- **XGBoost on macOS needs `libomp`, and macOS doesn't ship it.** Without Homebrew, the copy scikit-learn bundles works; the recipe is under [Run it locally](#run-it-locally).
- **A one-word `.gitignore` line hid a whole page.** `models/` was meant for the model folder at the root but also matched `website/app/dashboard/models/`, so the console's sidebar linked to a page that was never committed. The rule is now `/models/`.
- **Isotonic calibration creates ties.** It is a step function, so 1,654 test-window transactions in the local run share a calibrated 1.000, and the queue order among them was arbitrary. Ties now break on the uncalibrated blend.
- **"In-sample" is about rows, not steps.** The first version flagged every step 1–34 score as optimistic. Unlabelled rows from those steps were never training data, so the rule is now: labelled **and** step 1–34.
- **A KPI computed client-side was capped by the page size.** The console loads the top 500 alerts, so "above threshold" could never exceed 500. The backend now counts the whole window.
- **GraphSAGE is the least reproducible component.** A CPU re-run matches every tabular model and ensemble within ±0.01 AP, but GraphSAGE moves by 0.079 AP. Its validation-tuned ensemble weight is small, so the ensemble barely shifts. Details in [`report/REPRODUCTION.md`](report/REPRODUCTION.md).
- **Report numbers drift when they are typed.** The section-5 tables now sit between marker comments and are regenerated from metrics; a test fails on any mismatch.

## What's real vs pending — the honesty table

| Item | Status | Detail |
|---|---|---|
| Committed test metrics (`results/metrics/`) | Real | From the original run on a CUDA laptop |
| Ensemble weights in `final_ensemble_weighted.json` | Copied | That run printed but did not save them; they were copied from the report text (0.46 / 0.28 / 0.22 / 0.03 / 0.01). `experiments/hybrid.py` now saves them, so the next CUDA run replaces the copy |
| Scores served by the local backend | Real, different run | Produced by a CPU re-run on this machine. Tabular models and ensembles match the committed metrics within ±0.01 AP; GraphSAGE does not (see `report/REPRODUCTION.md`) |
| Console alerts, cases, flow graph, scoring | Real | Read from the backend; no seeded or sample data |
| Landing page figures (`website/components/views/`) | Pending | Dataset counts, model metrics and example transactions are typed into the markup rather than generated |
| Time-step ranges and alert budgets in the UI | Pending | Several pages spell out 1–29 / 30–34 / 35–49 and 50 / 100 / 250 instead of reading `chainsleuth/config.py` |
| DOCX report | Real, optional tooling | `python -m experiments.build_report` needs pandoc (or `pip install pypandoc_binary`) |
| Prose numbers outside report section 5 | Typed | The abstract, discussion and conclusion quote figures by hand; only the section-5 tables are generated |

## Attack → test

| The abuse | The test that answers it |
|---|---|
| Hand-edit a number in the report | `test_sync_replaces_a_tampered_cell` |
| Delete a metrics file the console depends on | `test_missing_metrics_file_is_loud` |
| Upload an empty, malformed or non-numeric CSV | `test_parse_errors_are_specific` |
| Upload more rows than the limit | `test_row_limit` |
| Pass string ids to a triage endpoint | `test_ids_must_be_ints` |
| Escalate into a case that does not exist | `test_escalate_to_missing_case_fails` |
| Set an unknown alert status | `test_bad_status_is_400` |
| Set the threshold outside [0, 1] or an unknown setting | `test_settings_defaults_and_validation` |
| Ask for a transaction that is not in the dataset | `test_unknown_tx_404`, `test_score_unknown_tx_404` |
| Score a training row and present it as a fair result | `test_score_known_tx_in_training_window` |

## The app

The console lives at `http://localhost:4430/dashboard/` once the website and backend are running.

| Page | What you can do |
|---|---|
| Overview | Above-threshold count over the whole test window, alerts per step and label, recent analyst activity |
| Alert queue | Filter by label, status and score; select rows to assign, clear or escalate; open any alert for its scores, SHAP reasons and notes |
| Flow canvas | Walk the directed 1- or 2-hop neighbourhood of any transaction; double-click to re-centre |
| Cases | Create cases, move them through open → in review → closed, add notes, unlink transactions |
| Score | Look up any transaction id, or score an uploaded CSV, with a threshold slider, agreement with known labels and a results download |
| Model comparison | Every model's AP, F1, ROC-AUC, precision, recall and P@100, plus the ensemble weights |
| Time steps | Transactions, labelled rows and illicit share per step across the split |
| Settings | Threshold, review budget, analyst name, and a reset for the analyst workspace |

The older `frontend/` app (port 3001) reads the same API and offers an alert table and a per-transaction investigation view.

## Limitations

- Labels cover 23% of the dataset. Performance on the unlabelled 77% cannot be measured.
- The dataset's 72 aggregated features describe one-hop neighbours and may carry information from later in the graph. This is a known property of the dataset, not something the pipeline adds.
- Illicit prevalence drops sharply in the test window, so absolute precision and recall would differ on another period.
- GraphSAGE results vary between hardware runs (see the engineering notes).
- Analyst state lives in one local SQLite file. There are no user accounts.

## Security

- The backend binds to `127.0.0.1` and has no authentication. It is built for one person on one machine.
- CORS allows only the local console and app ports by default; extra origins go in `CHAINSLEUTH_ORIGINS`.
- CSV uploads are capped at 8 MB and 5,000 rows, and parsed as numbers only.
- No external network calls are made at runtime. The only download is the dataset, in step 1.
- Data, models and the workflow database are gitignored.

## Tech stack

Python 3.12 · pandas · NumPy · scikit-learn · XGBoost · PyTorch · PyTorch Geometric · Optuna · SHAP · NetworkX · FastAPI · SQLite · Next.js 16 · React 19 · Tailwind CSS 4 · Recharts · Zustand · pytest

## Project layout

```
chainsleuth/        config, data loading, splits, metrics, PyG graph
experiments/        one runnable script per pipeline phase, plus report and site exporters
backend/            main.py (FastAPI), scoring.py, workflow.py
website/            Next.js static site; app/dashboard/ is the investigation console
frontend/           Next.js investigation app (alert table + transaction view)
results/metrics/    every metric as JSON, plus comparison tables
results/figures/    every figure in the report
report/             REPORT.md, REPRODUCTION.md, DOCX export
tests/              72 tests across 8 files
run_app.sh          macOS/Linux launcher (backend + frontend)
run_app.bat         Windows launcher
```

## Full command reference

```bash
python -m experiments.download_data     # dataset -> data/raw, data/processed
python -m experiments.eda               # figures + eda_summary.json
python -m experiments.baselines         # untuned models on validation
python -m experiments.anomaly           # isolation forest + autoencoder
python -m experiments.tune --trials 30  # Optuna on validation AP
python -m experiments.evaluate          # one test-window evaluation + ablations
python -m experiments.graph_features    # NetworkX topology features
python -m experiments.graph_models      # GraphSAGE
python -m experiments.hybrid            # ensemble + calibration + test_scores.parquet
python -m experiments.export_site_data  # metrics -> website/lib/dash/real.ts
python -m experiments.report_tables     # metrics -> REPORT.md section 5 (--check to verify)
python -m experiments.build_report      # REPORT.md -> DOCX (needs pandoc)
pytest tests/
```

`CHAINSLEUTH_DEVICE=cpu|cuda|mps` forces the training device. `CHAINSLEUTH_DB` moves the workflow database.

## Run it locally

```bash
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m experiments.download_data
python -m experiments.graph_features
python -m experiments.evaluate
python -m experiments.hybrid
```

Those four steps produce what the backend needs: `models/xgboost.joblib`, `models/random_forest.joblib` and `data/processed/test_scores.parquet`. Then start the three processes:

```bash
python -m uvicorn backend.main:app --port 8000      # backend
cd website && bun install && bun dev                # site + console -> http://localhost:4430/dashboard/
cd frontend && bun install && bun dev --port 3001   # older investigation app
```

`./run_app.sh` (macOS/Linux) or `run_app.bat` (Windows) starts the backend and `frontend/` together.

**macOS:** if `import xgboost` fails on `libomp.dylib`, borrow scikit-learn's copy:

```bash
SP=$(python -c "import site; print(site.getsitepackages()[0])")
cp "$SP/sklearn/.dylibs/libomp.dylib" "$SP/xgboost/lib/"
install_name_tool -add_rpath @loader_path "$SP/xgboost/lib/libxgboost.dylib"
codesign -f -s - "$SP/xgboost/lib/libxgboost.dylib"
```

## How I'd deploy it

It is not deployed. To run it for a team, I would put the backend behind an authenticating reverse proxy on one VM, move the workflow store from SQLite to Postgres with per-user accounts, and serve the static `website/out/` export from the same origin so CORS is no longer needed. The models and scores are read-only artifacts, so a redeploy is a copy of `models/` and `data/processed/test_scores.parquet`.

## Results and supporting records

Committed test-window results (steps 35–49, 16,670 labelled rows), from `results/metrics/`:

| Model | AP | F1 | P@100 | Source |
|---|---|---|---|---|
| XGBoost (tuned) | 0.801 | 0.796 | 1.00 | `final_xgboost.json` |
| XGBoost + graph features | 0.802 | 0.800 | 1.00 | `final_xgb_graph_features.json` |
| XGBoost + GNN blend | 0.796 | 0.818 | 1.00 | `final_xgb_gnn_blend.json` |
| Weighted ensemble | 0.799 | 0.814 | 1.00 | `final_ensemble_weighted.json` |
| GraphSAGE | 0.679 | 0.633 | 0.99 | `final_graphsage.json` |
| XGBoost, random split (leaky) | 0.986 | 0.959 | 1.00 | `experiment_random_split_xgboost.json` |

Records behind them:

- [`report/REPORT.md`](report/REPORT.md): problem, literature, EDA, method, generated results tables, ablations and discussion
- [`report/REPRODUCTION.md`](report/REPRODUCTION.md): the CPU re-run compared row by row with the committed metrics
- [`results/metrics/comparison.md`](results/metrics/comparison.md): every model in one table
- `results/figures/`: PR curves, SHAP summary, calibration, drift, separability, degree distributions
- [`SPEC.md`](SPEC.md): the evaluation contract, split policy and success criteria

## Tests

```
$ pytest tests/ -q
72 passed, 2 warnings in 1.72s
```

| File | Tests | Covers |
|---|---|---|
| `tests/test_backend.py` | 15 | Ranking, tie-breaks, console snapshot, triage, cases, settings, flow graph |
| `tests/test_scoring.py` | 18 | CSV parsing, row limits, in-sample rules, score endpoints, sample round-trip |
| `tests/test_workflow.py` | 13 | Statuses, escalation, case links, notes, settings, reset |
| `tests/test_export_site_data.py` | 6 | Console data export fields, missing files, weight order, step counts |
| `tests/test_leakage.py` | 6 | Feature list, random split, GNN masks, train-only scaler |
| `tests/test_report_tables.py` | 5 | Report matches metrics, tampered cells are restored |
| `tests/test_core.py` | 5 | Temporal split, unknown exclusion, metrics at K |
| `tests/test_config.py` | 4 | Split windows, device selection |
| **Total** | **72** | |

The backend tests run against a small in-memory fixture, so the suite needs neither the dataset nor the trained models.

## License

No licence file has been added yet, so the code is all rights reserved by default. The console's UI components under `website/components/ui/` carry their own MIT notice in [`website/components/ui/LICENSE.md`](website/components/ui/LICENSE.md).
