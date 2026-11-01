"""Phase 7: GraphSAGE node classification on the Elliptic transaction graph.

Protocol mirrors the tabular setup: train-mask = labeled nodes in steps 1-29,
early-stop on val-mask AP (steps 30-34), then retrain on train+val mask and
evaluate once on test-mask (35-49). Scores for ALL test-window transactions
(including unknown labels) are saved for the hybrid + dashboard.

Run: python -m experiments.graph_models [--epochs 150] [--hidden 256]
"""
from __future__ import annotations

import argparse
import copy

import joblib
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.nn.functional as F
from sklearn.metrics import average_precision_score
from torch_geometric.nn import SAGEConv

from chainsleuth.config import DATA_PROCESSED, MODELS_DIR, SEED, TEST_STEPS
from chainsleuth.experiments import save_metrics
from chainsleuth.graph import load_graph
from chainsleuth.metrics import evaluate_scores


class GraphSAGE(nn.Module):
    def __init__(self, in_dim: int, hidden: int, dropout: float):
        super().__init__()
        self.conv1 = SAGEConv(in_dim, hidden)
        self.conv2 = SAGEConv(hidden, 2)
        self.dropout = dropout

    def forward(self, x, edge_index):
        h = F.relu(self.conv1(x, edge_index))
        h = F.dropout(h, p=self.dropout, training=self.training)
        return self.conv2(h, edge_index)


def train_gnn(data, train_mask, eval_mask, y_eval, epochs: int, hidden: int,
              lr: float, dropout: float, patience: int, device: str,
              verbose: bool = True):
    """Train GraphSAGE with class-weighted CE; early-stop on eval-mask AP."""
    torch.manual_seed(SEED)
    model = GraphSAGE(data.num_features, hidden, dropout).to(device)
    data = data.to(device)
    pos = int(data.y[train_mask].sum())
    neg = int(train_mask.sum()) - pos
    weight = torch.tensor([1.0, neg / max(pos, 1)], device=device)
    opt = torch.optim.Adam(model.parameters(), lr=lr, weight_decay=5e-4)
    loss_fn = nn.CrossEntropyLoss(weight=weight)

    best_ap, best_state, best_epoch, stale = -1.0, None, -1, 0
    for epoch in range(1, epochs + 1):
        model.train()
        opt.zero_grad()
        out = model(data.x, data.edge_index)
        loss = loss_fn(out[train_mask], data.y[train_mask])
        loss.backward()
        opt.step()

        model.eval()
        with torch.no_grad():
            probs = F.softmax(model(data.x, data.edge_index), dim=1)[:, 1]
        ap = average_precision_score(
            y_eval, probs[eval_mask].cpu().numpy())
        if ap > best_ap:
            best_ap, best_epoch, stale = ap, epoch, 0
            best_state = copy.deepcopy(model.state_dict())
        else:
            stale += 1
        if verbose and epoch % 10 == 0:
            print(f"  epoch {epoch}: loss={loss.item():.4f} eval AP={ap:.4f}")
        if stale >= patience:
            if verbose:
                print(f"  early stop at epoch {epoch} (best {best_epoch}, AP={best_ap:.4f})")
            break

    model.load_state_dict(best_state)
    return model, best_ap


def gnn_scores(model, data, device) -> np.ndarray:
    model.eval()
    with torch.no_grad():
        return F.softmax(model(data.x, data.edge_index), dim=1)[:, 1].cpu().numpy()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=150)
    parser.add_argument("--hidden", type=int, default=256)
    parser.add_argument("--lr", type=float, default=0.005)
    parser.add_argument("--dropout", type=float, default=0.3)
    parser.add_argument("--patience", type=int, default=20)
    args = parser.parse_args()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    data = load_graph()
    print(f"device={device}")

    # --- phase A: train on steps 1-29, early-stop on val ---------------------
    # note: Data.to(device) is in-place; masks live on `device` after training
    y_val = data.y[data.val_mask].cpu().numpy()
    print("[phase A] train-mask = steps 1-29")
    model, val_ap = train_gnn(data, data.train_mask, data.val_mask, y_val,
                              args.epochs, args.hidden, args.lr, args.dropout,
                              args.patience, device)
    scores_val = gnn_scores(model, data, device)[data.val_mask.cpu().numpy()]
    m = evaluate_scores(y_val, scores_val)
    save_metrics("gnn_graphsage", {"model": "graphsage", "family": "graph",
                                   "split": "temporal", "val": m,
                                   "params": {"hidden": args.hidden, "lr": args.lr,
                                              "dropout": args.dropout,
                                              "epochs": args.epochs}})
    print(f"  val AP={m['avg_precision']:.4f} P@100={m['precision@100']:.3f}")

    # --- phase B: retrain on train+val mask, eval on test ---------------------
    y_test = data.y[data.test_mask].cpu().numpy()
    fit_mask = data.train_mask | data.val_mask
    print("[phase B] retrain on steps 1-34")
    model, _ = train_gnn(data, fit_mask, data.test_mask, y_test,
                         args.epochs, args.hidden, args.lr, args.dropout,
                         args.patience, device)
    all_scores = gnn_scores(model, data, device)
    m = evaluate_scores(y_test, all_scores[data.test_mask.cpu().numpy()])
    save_metrics("final_gnn_graphsage", {"model": "graphsage", "family": "graph",
                                         "split": "temporal", "test": m})
    print(f"  test AP={m['avg_precision']:.4f} P@100={m['precision@100']:.3f}")

    torch.save(model.state_dict(), MODELS_DIR / "graphsage.pt")

    # scores for every test-window transaction (incl. unknown) -> hybrid/dashboard
    test_window = np.isin(data.time_step.cpu().numpy(), list(TEST_STEPS))
    pd.DataFrame({
        "tx_id": data.tx_id.cpu().numpy()[test_window],
        "gnn_score": all_scores[test_window],
    }).to_parquet(DATA_PROCESSED / "gnn_test_scores.parquet")
    print(f"saved gnn scores for {test_window.sum():,} test-window transactions")


if __name__ == "__main__":
    main()
