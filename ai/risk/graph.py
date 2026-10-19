"""Graph-based model of links between competing bidders (Chapter 3, 3.5.7).

1. Build the co-bidding network: bidders are nodes; two bidders are linked by the number of tenders they both bid on.
2. Find tight groups of bidders with Louvain community detection.
3. For each tender, measure how far its bidders look like a closed group taking turns: rivals from the winner's group,
   how much the group bids only among itself (cohesion), and rivals who keep losing to the same winner.

The graph score is the share of tenders that look less group-like (a percentile, 0-1), learnt on the ZPPA network.
Large open competitions (more than MAX_PAIR_BIDDERS bidders) do not add pairs: crowds are not cartels.
"""
from collections import Counter, defaultdict
from itertools import combinations

import networkx as nx
import numpy as np
import pandas as pd

MAX_PAIR_BIDDERS = 30
MIN_LINK = 2  # co-bids needed for a link in the community graph
SEED = 42


def build(bids):
    """bids: DataFrame with ocid, bidder, won. Returns the fitted network statistics (a plain dict, picklable)."""
    by_tender = bids.groupby("ocid")
    pair = Counter()
    bidder_tenders = Counter(bids["bidder"])
    for _, g in by_tender:
        members = sorted(set(g["bidder"]))
        if 2 <= len(members) <= MAX_PAIR_BIDDERS:
            pair.update(combinations(members, 2))

    # Head-to-head: how often each loser lost to each winner
    lost_to = Counter()
    for _, g in by_tender:
        winners = g.loc[g["won"] == 1, "bidder"].tolist()
        losers = g.loc[g["won"] == 0, "bidder"].tolist()
        if len(g) <= MAX_PAIR_BIDDERS:
            for w in winners:
                for l in losers:
                    lost_to[(l, w)] += 1

    graph = nx.Graph()
    graph.add_weighted_edges_from((a, b, n) for (a, b), n in pair.items() if n >= MIN_LINK)
    communities = nx.community.louvain_communities(graph, weight="weight", seed=SEED) if graph.number_of_edges() else []
    group = {}
    for i, members in enumerate(communities):
        for m in members:
            group[m] = i

    # Cohesion: of a bidder's co-bids, the share that are with members of its own group
    inside = defaultdict(int)
    total = defaultdict(int)
    for (a, b), n in pair.items():
        for x, y in ((a, b), (b, a)):
            total[x] += n
            if x in group and group.get(y) == group[x]:
                inside[x] += n
    cohesion = {b: inside[b] / total[b] for b in total if total[b]}

    return {
        "pair": {k: v for k, v in pair.items() if v >= MIN_LINK},
        "lost_to": {k: v for k, v in lost_to.items() if v >= 2},
        "group": group,
        "cohesion": cohesion,
        "bidder_tenders": dict(bidder_tenders),
        "n_groups": len(communities),
    }


def tender_features(net, bidders, winner=None):
    """Graph features for one tender from its bidder IDs and winner (if known). Unknown bidders count as unlinked."""
    bidders = sorted(set(b for b in bidders if b))
    f = {"g_known_bidders": float(len(bidders))}
    pairs = [net["pair"].get(p, 0) for p in combinations(bidders, 2)] if len(bidders) <= MAX_PAIR_BIDDERS else []
    # Co-bids on OTHER tenders: this tender itself contributed one to each pair
    f["g_max_pair_cobids"] = float(max([p - 1 for p in pairs if p], default=0))
    if winner and winner in net["group"]:
        g = net["group"][winner]
        rivals = [b for b in bidders if b != winner]
        f["g_rivals_in_winner_group"] = float(sum(net["group"].get(b) == g for b in rivals))
        f["g_group_cohesion"] = float(net["cohesion"].get(winner, 0.0))
        f["g_repeat_losers"] = float(sum(net["lost_to"].get((b, winner), 0) >= 3 for b in rivals))
    else:
        f["g_rivals_in_winner_group"] = 0.0
        f["g_group_cohesion"] = 0.0
        f["g_repeat_losers"] = 0.0
    return f


def raw_graph_risk(f):
    """How group-like a tender is, before ranking. Rivals from the winner's own tight group, who keep losing to it,
    on a tender whose bidders often meet elsewhere."""
    if f["g_known_bidders"] < 2:
        return 0.0
    return (f["g_rivals_in_winner_group"] * (0.5 + f["g_group_cohesion"])
            + f["g_repeat_losers"] + np.log1p(f["g_max_pair_cobids"]))


def features_for_all(net, bids, tender_ids):
    """Graph features for every tender in tender_ids (missing tenders get zeros)."""
    grouped = {o: g for o, g in bids.groupby("ocid")}
    rows = []
    for o in tender_ids:
        g = grouped.get(o)
        if g is None:
            rows.append(tender_features(net, []))
        else:
            winners = g.loc[g["won"] == 1, "bidder"].tolist()
            rows.append(tender_features(net, g["bidder"].tolist(), winners[0] if winners else None))
    return pd.DataFrame(rows, index=tender_ids)


def fit_scale(raw_scores):
    """The sorted raw scores of the ZPPA tenders, to turn a raw score into a percentile."""
    return np.sort(np.asarray(raw_scores, dtype=float))


def percentile(scale, raw):
    return float(np.searchsorted(scale, raw, side="right") / len(scale))
