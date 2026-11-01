"""ChainSleuth AML - investigation dashboard (Phase 10).

Three views: Alert Center (ranked queue), Transaction Inspector (scores +
SHAP explanation), Network (1-2 hop neighbourhood of a flagged transaction).

Run from project root:  streamlit run dashboard/app.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from chainsleuth.config import DATA_PROCESSED, MODELS_DIR
from chainsleuth.data import load_dataset, load_raw
from chainsleuth.splits import feature_cols

st.set_page_config(page_title="ChainSleuth AML", layout="wide")

LABEL_MAP = {1: "illicit", 0: "licit", -1: "unknown"}
COLOR_MAP = {"illicit": "#e74c3c", "licit": "#3498db", "unknown": "#bdc3c7",
             "selected": "#f1c40f"}


@st.cache_data
def load_all():
    scores = pd.read_parquet(DATA_PROCESSED / "test_scores.parquet")
    df = load_dataset()
    _, _, edges = load_raw()
    return scores, df, edges


@st.cache_resource
def load_explainer(_model):
    import shap
    return shap.TreeExplainer(_model)


@st.cache_resource
def load_xgb():
    import joblib
    return joblib.load(MODELS_DIR / "xgboost.joblib")


def neighborhood_graph(edges, center_tx, df_label, hops=2, max_nodes=80):
    """Plotly network of the hop-neighbourhood around a transaction."""
    import networkx as nx

    adj = {}
    for s, d in edges.itertuples(index=False):
        adj.setdefault(s, []).append(d)
        adj.setdefault(d, []).append(s)

    seen, frontier = {center_tx}, {center_tx}
    for _ in range(hops):
        nxt = set()
        for n in frontier:
            for m in adj.get(n, []):
                if m not in seen:
                    seen.add(m); nxt.add(m)
        frontier = nxt
        if len(seen) > max_nodes:
            break
    seen = set(list(seen)[:max_nodes])

    sub = edges[edges["src_tx"].isin(seen) & edges["dst_tx"].isin(seen)]
    G = nx.Graph()
    G.add_edges_from(sub[["src_tx", "dst_tx"]].itertuples(index=False))
    G.add_node(center_tx)
    pos = nx.spring_layout(G, seed=7)

    ex, ey = [], []
    for a, b in G.edges():
        ex += [pos[a][0], pos[b][0], None]
        ey += [pos[a][1], pos[b][1], None]
    edge_trace = go.Scatter(x=ex, y=ey, mode="lines",
                            line=dict(width=0.6, color="#999"), hoverinfo="none")

    node_x, node_y, node_c, node_t = [], [], [], []
    for n in G.nodes():
        lab = LABEL_MAP.get(int(df_label.get(n, -1)), "unknown")
        node_x.append(pos[n][0]); node_y.append(pos[n][1])
        node_c.append(COLOR_MAP["selected"] if n == center_tx else COLOR_MAP[lab])
        node_t.append(f"tx {n}<br>label: {lab}")
    node_trace = go.Scatter(x=node_x, y=node_y, mode="markers", text=node_t,
                            marker=dict(size=9, color=node_c, line_width=1,
                                        line_color="#333"),
                            hoverinfo="text")
    fig = go.Figure([edge_trace, node_trace])
    fig.update_layout(showlegend=False, height=520, margin=dict(l=10, r=10, t=30, b=10),
                      xaxis=dict(showgrid=False, zeroline=False, showticklabels=False),
                      yaxis=dict(showgrid=False, zeroline=False, showticklabels=False),
                      title=f"{len(G.nodes())} nodes within {hops} hops of {center_tx}")
    return fig


def main():
    st.title("ChainSleuth AML")
    st.caption("Suspicious-transaction triage on the Elliptic test window "
               "(time steps 35-49). Scores rank *suspicion*, not proven criminality.")

    try:
        scores, df, edges = load_all()
    except FileNotFoundError:
        st.error("Run `python -m experiments.hybrid` first to generate test_scores.parquet")
        return

    # ------------------------------------------------------------- sidebar
    with st.sidebar:
        st.header("Alert queue controls")
        min_score = st.slider("minimum hybrid score", 0.0, 1.0, 0.5, 0.05)
        label_filter = st.multiselect("labels", ["illicit", "licit", "unknown"],
                                      default=["illicit", "licit", "unknown"])
        steps = sorted(scores["time_step"].unique())
        step_range = st.slider("time steps", int(min(steps)), int(max(steps)),
                               (int(min(steps)), int(max(steps))))

    view = scores[
        (scores["score_hybrid_calibrated"].fillna(scores["score_hybrid"]) >= min_score)
        & scores["label"].map(LABEL_MAP).isin(label_filter)
        & scores["time_step"].between(*step_range)
    ].copy()
    view["label_name"] = view["label"].map(LABEL_MAP)

    c1, c2, c3, c4 = st.columns(4)
    c1.metric("flagged", f"{len(view):,}")
    c2.metric("labeled illicit in view", f"{(view['label'] == 1).sum():,}")
    topk_labeled = view[view["label"] >= 0].head(100)
    c3.metric("top-100 precision (labeled only)",
              f"{(topk_labeled['label'] == 1).mean():.0%}" if len(topk_labeled) else "n/a")
    c4.metric("unknown scored", f"{(view['label'] < 0).sum():,}")

    # ---------------------------------------------------------- alert table
    st.subheader("Alert Center")
    cols = ["tx_id", "time_step", "label_name", "score_hybrid_calibrated",
            "score_hybrid", "score_xgb", "score_gnn", "score_iso", "score_ae"]
    show = view[[c for c in cols if c in view.columns]].rename(
        columns=lambda c: c.replace("score_", ""))
    st.dataframe(show, width="stretch", height=320)

    tx_id = st.selectbox("inspect transaction", view["tx_id"].head(500).tolist())
    if tx_id is None:
        return
    row = view[view["tx_id"] == tx_id].iloc[0]
    tab_scores, tab_why, tab_graph = st.tabs(
        ["Model scores", "Why was it flagged?", "Network"])

    with tab_scores:
        srow = {c.replace("score_", ""): row[c] for c in row.index
                if c.startswith("score_") and pd.notna(row[c])}
        st.bar_chart(pd.Series(srow).sort_values(ascending=False))
        st.write({k: round(float(v), 4) for k, v in srow.items()})
        st.write(f"dataset label: **{LABEL_MAP[int(row['label'])]}** "
                 f"| time step: **{int(row['time_step'])}**")

    with tab_why:
        model = load_xgb()
        explainer = load_explainer(model)
        cols_f = feature_cols(df)
        X = df.loc[df["tx_id"] == tx_id, cols_f].to_numpy(np.float32)
        if len(X):
            sv = explainer.shap_values(X)[0]
            contrib = pd.Series(sv, index=cols_f).sort_values(key=abs, ascending=False)
            st.write("Top SHAP contributions (XGBoost):")
            st.bar_chart(contrib.head(15))
            st.dataframe(
                pd.DataFrame({"feature": contrib.head(15).index,
                              "shap": contrib.head(15).values,
                              "value": X[0][[cols_f.index(f) for f in contrib.head(15).index]]}),
                width="stretch")
        else:
            st.info("transaction features not found")

    with tab_graph:
        hops = st.radio("hops", [1, 2], horizontal=True)
        df_label = df.set_index("tx_id")["label"]
        st.plotly_chart(neighborhood_graph(edges, tx_id, df_label, hops=hops),
                        width="stretch")


if __name__ == "__main__":
    main()
