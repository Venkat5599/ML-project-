# Spec: ChainSleuth AML

## Objective

Detect potentially illicit Bitcoin transactions in the Elliptic dataset by combining
transaction-level features, unsupervised anomaly detection, and (in later phases)
graph/network information — with explainable, ranked alerts instead of a bare
yes/no classifier.

Research question: *Can combining transaction-level features with wallet-network
structure detect suspicious cryptocurrency activity more effectively than
conventional tabular ML models, while explaining why a transaction was flagged?*

Framing rules (important for the report):

- Elliptic labels are `licit`, `illicit`, and `unknown`. **Unknown ≠ licit.**
  Unknown transactions are excluded from supervised training/evaluation and are
  only scored, never treated as ground truth.
- Output is a *suspicion ranking*, not proof of criminality. All result language
  must say "flagged as suspicious", never "is a criminal transaction".
- Evaluation must be **temporal**: train on earlier time steps, test on later
  time steps. The Elliptic 93 aggregated features describe one-hop neighbours;
  we flag in the report that they may carry future-graph information and do not
  let any of our own engineered features leak.

## Tech Stack

- Python 3.11, pandas, numpy, scikit-learn, XGBoost
- PyTorch (autoencoder; PyG later for GraphSAGE)
- Optuna (tuning), SHAP (explainability), NetworkX (graph EDA)
- matplotlib/seaborn (figures)
- FastAPI + Next.js (local investigation app in `backend/` + `frontend/`)
- Next.js static site and investigation console (`website/`)
- Parquet via pyarrow for processed data cache

## Commands

```bash
pip install -r requirements.txt
python -m experiments.download_data      # download + cache raw CSVs -> parquet
python -m experiments.eda                # EDA figures + stats -> results/
python -m experiments.baselines          # default-param models -> results/metrics
python -m experiments.tune               # Optuna tuning -> results/metrics
python -m experiments.evaluate           # final comparison table + PR curves
pytest tests/                            # unit tests
```

## Project Structure

```
data/raw/          Downloaded Elliptic CSVs (gitignored)
data/processed/    Parquet cache, test scores, workflow.sqlite (gitignored)
models/            Fitted models (gitignored)
results/figures/   All plots used in the report
results/metrics/   metrics JSON/CSVs
report/            Report + DOCX export
chainsleuth/       Reusable pipeline code
experiments/       Runnable experiment entrypoints (numbered phases)
backend/           FastAPI scoring/explanation API + analyst workflow store
frontend/          Next.js investigation app
website/           Next.js static site + investigation console
tests/             Unit tests: split/metrics logic, workflow, API contract
```

## Evaluation Contract

- **Split**: time steps 1–29 train, 30–34 validation (tuning only),
  35–49 test (touched once, at final eval). A random-split variant is run as a
  comparison experiment to show leakage/optimism.
- **Supervised metrics** on labeled test data: precision, recall, F1,
  average precision (PR-AUC), ROC-AUC, Precision@K / Recall@K
  (K = 50, 100, 250), batch inference time.
- **Anomaly models** scored the same way (higher score = more suspicious).
- Experiments to run: tabular vs. anomaly, default vs. tuned params,
  random vs. temporal split, full vs. reduced features.

## Boundaries

- Always: keep unknown-labeled transactions out of supervised train/eval;
  seed everything (`SEED = 42`); save metrics as machine-readable JSON.
- Ask first: adding heavy dependencies, changing the split policy.
- Never: claim detections prove criminality; tune on the test set; commit data
  or model artifacts to git.

## Success Criteria

- [x] Reproducible pipeline: fresh clone -> download -> baselines -> tuned models
      (every experiment re-run on CPU; deltas vs. the CUDA run in `report/REPRODUCTION.md`)
- [x] Metrics table comparing >= 5 tabular models + 2 anomaly detectors
      (`results/metrics/comparison.md`: LR, DT, RF, XGBoost, SVM + isolation forest, autoencoder)
- [x] Temporal vs. random split comparison demonstrating split effect
      (`experiment_random_split_xgboost.json`: +18.6 AP points from leakage)
- [x] EDA figures: class imbalance, labels-over-time, feature distributions,
      correlation heatmap, graph degree distribution (`results/figures/`)
- [x] Report-ready results section generated from saved metrics (no hand-typed numbers)
      (`python -m experiments.report_tables` renders every section-5 table; a test
      fails when they drift from `results/metrics`)
