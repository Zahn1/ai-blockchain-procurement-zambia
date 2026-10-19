"""How the three models combine into one risk score (Chapter 3, 3.5.7). Shared by training and the service."""
import numpy as np

THRESHOLD = 70  # alerts at this score or above; also the ledger's high-risk score (chaincode HighRiskScore)
TAIL = 0.95     # the unsupervised and graph models count only above their 95th percentile


def tail(percentile):
    """0 below the 95th percentile, rising to 1 at the most unusual case."""
    return np.clip((np.asarray(percentile, dtype=float) - TAIL) / (1 - TAIL), 0, 1)


def combine(p_supervised, a_unsupervised, a_graph):
    """score = 100 x [1 - (1-p)(1 - 0.75 a_IF)(1 - 0.9 a_graph)]: high if any model is confident, higher if they agree."""
    p = np.asarray(p_supervised, dtype=float)
    return 100 * (1 - (1 - p) * (1 - 0.75 * np.asarray(a_unsupervised)) * (1 - 0.9 * np.asarray(a_graph)))
