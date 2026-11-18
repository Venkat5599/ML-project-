# Reproduction on CPU

The committed `results/metrics` come from the original CUDA run. On 2026-11-18 the
pipeline was re-run from a fresh clone on an Apple M5 laptop (CPU only, no CUDA):

```bash
python -m experiments.download_data
python -m experiments.graph_features
python -m experiments.evaluate
python -m experiments.hybrid
```

The table compares the committed test-window numbers with that CPU run. It was
generated from the two sets of metric JSON files; nothing is typed by hand.

| model | AP (CUDA) | AP (CPU) | ΔAP | F1 (CUDA) | F1 (CPU) | P@100 (CUDA) | P@100 (CPU) |
|---|---|---|---|---|---|---|---|
| logistic_regression | 0.273 | 0.280 | +0.007 | 0.327 | 0.330 | 0.14 | 0.16 |
| decision_tree | 0.211 | 0.214 | +0.003 | 0.410 | 0.413 | 0.09 | 0.57 |
| random_forest | 0.794 | 0.793 | -0.001 | 0.766 | 0.764 | 1.00 | 1.00 |
| xgboost | 0.801 | 0.801 | +0.000 | 0.796 | 0.804 | 1.00 | 1.00 |
| svm | 0.592 | 0.592 | +0.000 | 0.532 | 0.532 | 0.83 | 0.83 |
| isolation_forest | 0.037 | 0.037 | +0.000 | 0.000 | 0.000 | 0.00 | 0.00 |
| autoencoder | 0.039 | 0.040 | +0.000 | 0.031 | 0.031 | 0.03 | 0.02 |
| graphsage | 0.679 | 0.600 | -0.079 | 0.633 | 0.621 | 0.99 | 0.74 |
| xgb_graph_features | 0.802 | 0.803 | +0.001 | 0.800 | 0.808 | 1.00 | 1.00 |
| xgb_gnn_blend | 0.796 | 0.794 | -0.002 | 0.818 | 0.806 | 1.00 | 1.00 |
| ensemble_weighted | 0.799 | 0.797 | -0.002 | 0.814 | 0.817 | 1.00 | 1.00 |
| ensemble_stacked | 0.799 | 0.797 | -0.002 | 0.798 | 0.801 | 1.00 | 1.00 |
| ensemble_calibrated | 0.776 | 0.777 | +0.001 | 0.805 | 0.817 | 1.00 | 1.00 |
| random_split_xgboost | 0.986 | 0.987 | +0.000 | 0.959 | 0.958 | 1.00 | 1.00 |
| top30_features_xgboost | 0.784 | 0.783 | -0.002 | 0.745 | 0.731 | 1.00 | 1.00 |

Every tabular model and every ensemble lands within ±0.01 AP of the committed
run. Two rows move more than that:

- **GraphSAGE** loses 0.079 AP and P@100 falls from 0.99 to 0.74. Its training
  uses dropout and scatter ops that do not give the same result on CPU and
  CUDA. The validation-tuned ensemble weight for the GNN was small in both runs
  (0.03 CUDA, 0.009 CPU), so the weighted ensemble moves by only 0.002 AP.
- **Decision tree P@100** jumps from 0.09 to 0.57 with AP almost unchanged. An
  unpruned tree outputs nearly all 0/1 probabilities, so its top 100 is a
  tie-break among equal scores, not a ranking. That is why the report compares
  models on AP.

The report keeps the CUDA numbers.
