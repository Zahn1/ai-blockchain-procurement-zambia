"""Unit tests for the graph-based model of links between bidders (Chapter 3, 3.5.7)."""
import pandas as pd
import pytest

from risk import graph


def market():
    """A small invented market: A, B and C bid together on six tenders and take turns winning (a ring);
    D, E, F and G compete openly, never meeting the same rivals twice in a row."""
    rows = []
    ring = ["A", "B", "C"]
    for i in range(6):
        for b in ring:
            rows.append((f"R{i}", b, int(b == ring[i % 3])))
    open_tenders = [("O1", ["D", "E"], "D"), ("O2", ["F", "G"], "G"), ("O3", ["D", "F"], "F"), ("O4", ["E", "G"], "E")]
    for ocid, bidders, winner in open_tenders:
        for b in bidders:
            rows.append((ocid, b, int(b == winner)))
    return pd.DataFrame(rows, columns=["ocid", "bidder", "won"])


@pytest.fixture(scope="module")
def net():
    return graph.build(market())


def test_bidders_who_keep_bidding_together_form_one_group(net):
    assert net["group"]["A"] == net["group"]["B"] == net["group"]["C"]
    assert net["pair"][("A", "B")] == 6
    # Open competitors met each other only once, below the link threshold, so they are not grouped
    assert not {"D", "E", "F", "G"} & set(net["group"])


def test_a_ring_bids_only_among_itself(net):
    assert net["cohesion"]["A"] == pytest.approx(1.0)


def test_repeated_losses_to_the_same_winner_are_counted(net):
    # Each ring member lost to each other member twice in six rotating tenders
    assert net["lost_to"][("B", "A")] == 2


def test_a_ring_tender_looks_group_like_and_an_open_one_does_not(net):
    ring = graph.tender_features(net, ["A", "B", "C"], winner="A")
    assert ring["g_rivals_in_winner_group"] == 2
    assert ring["g_max_pair_cobids"] == 5  # met on five other tenders
    open_ = graph.tender_features(net, ["D", "E"], winner="D")
    assert open_["g_rivals_in_winner_group"] == 0
    assert graph.raw_graph_risk(ring) > graph.raw_graph_risk(open_)


def test_unknown_or_single_bidders_give_no_evidence(net):
    f = graph.tender_features(net, ["X", "Y"], winner="X")
    assert f["g_rivals_in_winner_group"] == 0 and f["g_group_cohesion"] == 0 and f["g_max_pair_cobids"] == 0
    assert graph.raw_graph_risk(graph.tender_features(net, ["A"], winner="A")) == 0.0


def test_large_open_competitions_add_no_pairs():
    crowd = pd.DataFrame([("BIG", f"S{i}", int(i == 0)) for i in range(graph.MAX_PAIR_BIDDERS + 1)], columns=["ocid", "bidder", "won"])
    twice = pd.concat([crowd, crowd.assign(ocid="BIG2")])
    assert graph.build(twice)["pair"] == {}


def test_features_for_all_gives_zeros_for_tenders_without_bids(net):
    df = graph.features_for_all(net, market(), ["R0", "MISSING"])
    assert df.loc["R0", "g_rivals_in_winner_group"] == 2
    assert (df.loc["MISSING"] == 0).all()


def test_scores_become_percentiles_of_the_learnt_scale():
    scale = graph.fit_scale([0.0, 1.0, 2.0, 3.0])
    assert graph.percentile(scale, 0.0) == 0.25
    assert graph.percentile(scale, 2.5) == 0.75
    assert graph.percentile(scale, 10.0) == 1.0
