"""Dataset download, loading, and parquet caching for the Elliptic dataset."""
from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

from .config import DATA_PROCESSED, DATA_RAW, FILES, HF_BASE, N_AGG_FEATURES, N_LOCAL_FEATURES

FEATURE_COLUMNS = (
    ["tx_id", "time_step"]
    + [f"local_{i}" for i in range(1, N_LOCAL_FEATURES + 1)]
    + [f"agg_{i}" for i in range(1, N_AGG_FEATURES + 1)]
)


def download(url: str, dest: Path) -> None:
    """Download a file with a simple progress bar."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        print(f"  already exists: {dest.name}")
        return

    def _progress(count, block_size, total):
        if total > 0:
            pct = count * block_size / total * 100
            mb = count * block_size / 1e6
            sys.stdout.write(f"\r  {dest.name}: {mb:.0f}/{total / 1e6:.0f} MB ({pct:.0f}%)")
            sys.stdout.flush()

    urllib.request.urlretrieve(url, dest, _progress)
    print()


def download_dataset() -> None:
    """Fetch the three raw Elliptic CSVs from the HuggingFace mirror."""
    for name, filename in FILES.items():
        print(f"[{name}]")
        download(f"{HF_BASE}/{filename}", DATA_RAW / filename)


def load_raw() -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Load raw CSVs -> (features_df, classes_df, edgelist_df). Cached to parquet."""
    cache = DATA_PROCESSED / "features.parquet"
    if cache.exists():
        features = pd.read_parquet(cache)
    else:
        features = pd.read_csv(
            DATA_RAW / FILES["features"], header=None, names=FEATURE_COLUMNS
        )
        features.to_parquet(cache)

    classes = pd.read_csv(DATA_RAW / FILES["classes"])
    classes.columns = ["tx_id", "class"]
    edges = pd.read_csv(DATA_RAW / FILES["edgelist"])
    edges.columns = ["src_tx", "dst_tx"]
    return features, classes, edges


def build_dataset() -> pd.DataFrame:
    """Join features + labels into one dataframe.

    Adds `label`: 1 = illicit, 0 = licit, -1 = unknown (never used as ground truth).
    """
    features, classes, _ = load_raw()
    df = features.merge(classes, on="tx_id", how="left")
    df["label"] = df["class"].map({"1": 1, "2": 0}).fillna(-1).astype(int)
    df = df.drop(columns=["class"])
    out = DATA_PROCESSED / "dataset.parquet"
    df.to_parquet(out)
    print(f"dataset: {len(df):,} rows, {df['label'].eq(1).sum():,} illicit, "
          f"{df['label'].eq(0).sum():,} licit, {df['label'].eq(-1).sum():,} unknown")
    return df


def load_dataset() -> pd.DataFrame:
    """Load the joined dataset, building it if necessary."""
    path = DATA_PROCESSED / "dataset.parquet"
    if not path.exists():
        return build_dataset()
    return pd.read_parquet(path)
