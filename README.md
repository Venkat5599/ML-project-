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

## Layout

- `chainsleuth/` - config, data loading, splits, metrics, experiment helpers
- `experiments/` - numbered pipeline stages (see docstrings)
- `results/figures/`, `results/metrics/` - report-ready outputs
- `tests/` - unit tests for split/metrics correctness
