"""Leakage-safe splitting: temporal (primary) and random (comparison only)."""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split

from .config import SEED, TEST_STEPS, TRAIN_STEPS, VAL_STEPS

def feature_cols(df: pd.DataFrame, include_agg: bool = True) -> list[str]:
    cols = [c for c in df.columns if c.startswith("local_")]
    if include_agg:
        cols += [c for c in df.columns if c.startswith("agg_")]
    return cols


def temporal_split(df: pd.DataFrame):
    """Split labeled rows by time step. Unknown labels are excluded entirely."""
    labeled = df[df["label"] >= 0]
    train = labeled[labeled["time_step"].isin(TRAIN_STEPS)]
    val = labeled[labeled["time_step"].isin(VAL_STEPS)]
    test = labeled[labeled["time_step"].isin(TEST_STEPS)]
    return train, val, test


def random_split(df: pd.DataFrame, train_frac: float = 0.6, val_frac: float = 0.2):
    """Random split of labeled rows - comparison experiment only, leaks temporally."""
    labeled = df[df["label"] >= 0]
    train, rest = train_test_split(
        labeled, train_size=train_frac, random_state=SEED, stratify=labeled["label"]
    )
    val, test = train_test_split(
        rest, train_size=val_frac / (1 - train_frac), random_state=SEED, stratify=rest["label"]
    )
    return train, val, test


def xy(df: pd.DataFrame, cols: list[str]) -> tuple[np.ndarray, np.ndarray]:
    return df[cols].to_numpy(dtype=np.float32), df["label"].to_numpy()
