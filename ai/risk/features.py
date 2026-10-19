"""Model inputs for tender and contract risk (Chapter 3, 3.5.7), prepared identically for training and scoring.

The rule flags and risk points from Phase 1 are deliberately NOT inputs: they produced the labels, so using them
would let the model learn the rules back instead of the patterns behind them.
"""
import math

import numpy as np
import pandas as pd

METHODS = ["limited", "open", "selective"]
CATEGORIES = ["goods", "works", "services", "unknown"]

# Tabular tender features (graph features are added by graph.py)
TENDER_NUMERIC = [
    "log_est_value", "value_band", "n_bidders", "period_days", "end_weekday", "award_ratio",
    "decision_days", "buyer_n_awards", "supplier_wins", "buyer_supplier_share", "pair_awards_same_month",
]
GRAPH = ["g_known_bidders", "g_max_pair_cobids", "g_rivals_in_winner_group", "g_group_cohesion", "g_repeat_losers"]
# The supervised and unsupervised models see only the tender's own details; the bidder network is the graph
# model's evidence alone. (Mixing them let the models learn that synthetic rows have no bidder list.)
TENDER_FEATURES = TENDER_NUMERIC + [f"method_{m}" for m in METHODS] + [f"cat_{c}" for c in CATEGORIES]

CONTRACT_FEATURES = [
    "log_contract_value", "n_milestones", "completion_ratio", "paid_ratio",
    "payments_before_completion", "duplicate_payments", "avg_days_late", "variation_recorded",
]


def value_band(est_value, edges):
    """Quintile of the estimated value, using the edges learnt from the ZPPA data."""
    if est_value is None or (isinstance(est_value, float) and math.isnan(est_value)):
        return np.nan
    return float(sum(est_value > e for e in edges))


def tender_frame(df):
    """From a frame with the raw tender columns (as in tenders.csv), the model's feature matrix."""
    out = pd.DataFrame(index=df.index)
    for c in TENDER_NUMERIC:
        out[c] = pd.to_numeric(df[c], errors="coerce") if c in df else np.nan
    for m in METHODS:
        out[f"method_{m}"] = (df.get("method") == m).astype(float)
    for c in CATEGORIES:
        out[f"cat_{c}"] = (df.get("category") == c).astype(float)
    return out[TENDER_FEATURES]


def contract_frame(df):
    out = pd.DataFrame(index=df.index)
    for c in CONTRACT_FEATURES:
        out[c] = pd.to_numeric(df[c], errors="coerce")
    return out[CONTRACT_FEATURES]
