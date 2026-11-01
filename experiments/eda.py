"""Phase 2: exploratory data analysis -> report-ready figures + stats JSON.

Outputs to results/figures/ and results/metrics/eda_summary.json.
Run: python -m experiments.eda
"""
from __future__ import annotations

import json

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns

from chainsleuth.config import FIGURES_DIR, METRICS_DIR, SEED
from chainsleuth.data import load_dataset, load_raw
from chainsleuth.splits import feature_cols

sns.set_theme(style="whitegrid")
plt.rcParams["figure.dpi"] = 130


def class_distribution(df: pd.DataFrame) -> dict:
    counts = df["label"].map({1: "illicit", 0: "licit", -1: "unknown"}).value_counts()
    color_map = {"illicit": "#c0392b", "licit": "#2e86ab", "unknown": "#95a5a6"}
    fig, ax = plt.subplots(figsize=(7, 4))
    counts.plot.bar(ax=ax, color=[color_map[c] for c in counts.index])
    ax.set_ylabel("transactions")
    ax.set_title("Elliptic dataset: class distribution (77% unlabeled)")
    for i, v in enumerate(counts):
        ax.text(i, v, f"{v:,}", ha="center", va="bottom", fontsize=9)
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "class_distribution.png")
    plt.close(fig)

    labeled = df[df["label"] >= 0]
    illicit = int(labeled["label"].sum())
    licit = int((labeled["label"] == 0).sum())
    return {
        "n_total": int(len(df)),
        "n_illicit": illicit,
        "n_licit": licit,
        "n_unknown": int((df["label"] < 0).sum()),
        "imbalance_ratio_licit_per_illicit": round(licit / illicit, 2),
    }


def labels_over_time(df: pd.DataFrame) -> None:
    tab = (
        df.assign(label_name=df["label"].map({1: "illicit", 0: "licit", -1: "unknown"}))
        .groupby(["time_step", "label_name"])
        .size()
        .unstack(fill_value=0)
        .reindex(columns=["illicit", "licit", "unknown"])
    )
    fig, axes = plt.subplots(2, 1, figsize=(10, 6), sharex=True,
                           gridspec_kw={"height_ratios": [3, 1]})
    tab.plot.area(ax=axes[0], color=["#c0392b", "#2e86ab", "#95a5a6"], alpha=0.75)
    axes[0].set_ylabel("transactions")
    axes[0].set_title("Transactions per time step by label")
    rate = tab["illicit"] / (tab["illicit"] + tab["licit"])
    rate.plot(ax=axes[1], color="#c0392b")
    axes[1].set_ylabel("illicit share\nof labeled")
    axes[1].set_xlabel("time step (≈2 weeks each)")
    axes[1].axvline(34, ls="--", c="k", alpha=0.5)
    axes[1].text(34.3, axes[1].get_ylim()[1] * 0.85, "test start", fontsize=8)
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "labels_over_time.png")
    plt.close(fig)


def feature_separability(df: pd.DataFrame) -> dict:
    """Find features that best separate licit vs illicit; plot top 6 boxplots."""
    labeled = df[df["label"] >= 0]
    cols = feature_cols(labeled)
    # standardized mean difference (Cohen's d), cheap and interpretable
    ill = labeled[labeled["label"] == 1][cols]
    lic = labeled[labeled["label"] == 0][cols]
    pooled_sd = np.sqrt((ill.var() + lic.var()) / 2).replace(0, np.nan)
    cohens_d = ((ill.mean() - lic.mean()).abs() / pooled_sd).sort_values(ascending=False)
    top6 = cohens_d.head(6)

    plot_df = labeled.assign(class_name=labeled["label"].map({0: "licit", 1: "illicit"}))
    fig, axes = plt.subplots(2, 3, figsize=(13, 6))
    for ax, feat in zip(axes.flat, top6.index):
        sns.boxplot(data=plot_df, x="class_name", y=feat, hue="class_name",
                    ax=ax, palette={"licit": "#2e86ab", "illicit": "#c0392b"},
                    showfliers=False, legend=False)
        ax.set_title(f"{feat}  (d={top6[feat]:.2f})", fontsize=9)
    fig.suptitle("Most separable features (Cohen's d, outliers hidden)")
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "top_feature_boxplots.png")
    plt.close(fig)
    return {"top_separable": {k: round(float(v), 3) for k, v in cohens_d.head(15).items()}}


def correlation_heatmap(df: pd.DataFrame) -> None:
    labeled = df[df["label"] >= 0].sample(20000, random_state=SEED)
    cols = feature_cols(labeled)
    corr = labeled[cols].corr().abs()
    # keep the 25 features with highest mean |corr| to others -> the redundant core
    keep = corr.mean().sort_values(ascending=False).head(25).index
    fig, ax = plt.subplots(figsize=(10, 8))
    sns.heatmap(labeled[keep].corr(), cmap="vlag", center=0, ax=ax,
                xticklabels=True, yticklabels=True, square=True)
    ax.set_title("Correlation heatmap: 25 most-intercorrelated features")
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "correlation_heatmap.png")
    plt.close(fig)


def graph_topology(edges: pd.DataFrame, df: pd.DataFrame) -> dict:
    """Degree distribution + component stats from the transaction edgelist."""
    import networkx as nx

    G = nx.DiGraph()
    G.add_edges_from(edges[["src_tx", "dst_tx"]].itertuples(index=False))
    in_deg = pd.Series(dict(G.in_degree()))
    out_deg = pd.Series(dict(G.out_degree()))

    fig, axes = plt.subplots(1, 2, figsize=(11, 4))
    for ax, deg, name in [(axes[0], in_deg, "in-degree"), (axes[1], out_deg, "out-degree")]:
        counts = deg.value_counts().sort_index()
        ax.scatter(counts.index, counts.values, s=10, alpha=0.7)
        ax.set_xscale("log"); ax.set_yscale("log")
        ax.set_xlabel(f"{name} (log)"); ax.set_ylabel("count (log)")
        ax.set_title(f"{name} distribution")
    fig.suptitle("Transaction graph degree distributions")
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "degree_distribution.png")
    plt.close(fig)

    wccs = list(nx.weakly_connected_components(G))
    biggest = max((len(c) for c in wccs), default=0)
    # neighbourhood illicit rate: share of labelled 1-hop neighbours that are illicit
    lab = df.set_index("tx_id")["label"]
    neigh_illicit, neigh_labeled = [], []
    for tx in df.loc[df["label"] >= 0, "tx_id"]:
        nb = set(G.predecessors(tx)) | set(G.successors(tx))
        labs = lab.reindex(list(nb)).dropna()
        labs = labs[labs >= 0]
        if len(labs):
            neigh_illicit.append(float(labs.mean()))
            neigh_labeled.append(len(labs))
    fig, ax = plt.subplots(figsize=(6, 4))
    ax.hist(np.clip(neigh_illicit, 0, 1), bins=40, color="#c0392b", alpha=0.8)
    ax.set_xlabel("fraction of labelled neighbours that are illicit")
    ax.set_ylabel("transactions")
    ax.set_title("Neighbourhood illicit-rate distribution")
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / "neighbourhood_illicit_rate.png")
    plt.close(fig)

    return {
        "n_edges": int(G.number_of_edges()),
        "n_nodes_in_graph": int(G.number_of_nodes()),
        "n_weak_components": len(wccs),
        "largest_component": int(biggest),
        "max_in_degree": int(in_deg.max()),
        "max_out_degree": int(out_deg.max()),
    }


def missing_and_summary(df: pd.DataFrame) -> dict:
    cols = feature_cols(df)
    return {
        "missing_values": int(df[cols].isna().sum().sum()),
        "duplicate_tx_ids": int(df["tx_id"].duplicated().sum()),
        "feature_ranges": {
            "min": float(df[cols].min().min()),
            "max": float(df[cols].max().max()),
        },
        "n_time_steps": int(df["time_step"].nunique()),
    }


def main() -> None:
    df = load_dataset()
    _, _, edges = load_raw()

    summary = {}
    summary.update(class_distribution(df))
    summary.update(missing_and_summary(df))
    labels_over_time(df)
    summary.update(feature_separability(df))
    correlation_heatmap(df)
    summary["graph"] = graph_topology(edges, df)

    out = METRICS_DIR / "eda_summary.json"
    with open(out, "w") as f:
        json.dump(summary, f, indent=2)
    print(json.dumps(summary, indent=2))
    print(f"\nfigures -> {FIGURES_DIR}")


if __name__ == "__main__":
    main()
