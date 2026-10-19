"""Tests for the AI risk service (Chapter 3, 3.5.7): /score and /explain."""
import pytest
from fastapi.testclient import TestClient

from service.app import app, models

client = TestClient(app)

CLEAN = {"est_value": 150000, "n_bidders": 4, "period_days": 14, "end_weekday": 2, "award_value": 140000,
         "buyer_n_awards": 30, "supplier_wins": 2, "buyer_supplier_share": 0.05, "pair_awards_same_month": 1,
         "method": "open", "category": "goods"}


def tender(**changes):
    return {"kind": "tender", "features": {**CLEAN, **changes}}


def explain(body):
    res = client.post("/explain", json=body)
    assert res.status_code == 200, res.text
    return res.json()


def test_health_reports_the_model_version():
    assert client.get("/health").json() == {"status": "ok", "modelVersion": models.version}


def test_a_normal_tender_scores_low_and_raises_no_alert():
    r = client.post("/score", json=tender()).json()
    assert r["score"] < r["threshold"] == 70
    assert r["alert"] is False


@pytest.mark.parametrize("changes, phrase", [
    ({"buyer_supplier_share": 0.8, "supplier_wins": 16, "n_bidders": 1, "buyer_n_awards": 40}, "won 80% of this buyer's awards"),
    ({"pair_awards_same_month": 7, "est_value": 195000, "award_value": 195000, "n_bidders": 1}, "same month"),
    ({"award_value": 330000, "est_value": 150000}, "above it"),
])
def test_known_risk_patterns_raise_an_alert_with_a_plain_english_reason(changes, phrase):
    r = explain(tender(**changes))
    assert r["alert"] is True
    assert any(phrase in x["text"] for x in r["reasons"]), r["reasons"]


def test_explanations_show_at_most_three_model_factors_in_sentences():
    r = explain(tender(buyer_supplier_share=0.8, supplier_wins=16, n_bidders=1, pair_awards_same_month=5))
    supervised = [x for x in r["reasons"] if x["model"] == "supervised"]
    assert 1 <= len(supervised) <= 3
    assert all(x["text"].endswith(".") and x["impact"] > 0 for x in r["reasons"])


def test_the_graph_model_flags_bidders_who_keep_bidding_together():
    net = models.t["graph_net"]
    (a, b), together = max(net["pair"].items(), key=lambda kv: kv[1])
    r = explain(tender(bidders=[a, b], winner=a, n_bidders=2))
    assert r["components"]["graphPercentile"] > 0.95
    graph_reasons = [x for x in r["reasons"] if x["model"] == "graph"]
    assert graph_reasons and f"bid together on {together - 1} other tenders" in graph_reasons[0]["text"]


def test_unknown_bidders_give_the_graph_model_no_evidence():
    r = client.post("/score", json=tender(bidders=["NEW-1", "NEW-2"], winner="NEW-1")).json()
    assert r["components"]["graphPercentile"] < 0.95
    assert client.post("/score", json=tender()).json()["components"]["graphPercentile"] is None


@pytest.mark.parametrize("changes, phrase", [
    ({"paid_ratio": 1.3}, "130% of the contract value"),
    ({"payments_before_completion": 1, "paid_ratio": 0.75}, "before the milestone was certified"),
    ({"duplicate_payments": 1, "paid_ratio": 1.0}, "duplicate payment"),
])
def test_contract_payment_anomalies_raise_alerts(changes, phrase):
    body = {"kind": "contract", "features": {"contract_value": 140000, "n_milestones": 2, "milestones_completed": 1,
                                              "paid_ratio": 0.5, **changes}}
    r = explain(body)
    assert r["alert"] is True
    assert any(phrase in x["text"] for x in r["reasons"]), r["reasons"]


def test_a_normal_contract_raises_no_alert():
    body = {"kind": "contract", "features": {"contract_value": 140000, "n_milestones": 2, "milestones_completed": 1, "paid_ratio": 0.43}}
    assert client.post("/score", json=body).json()["alert"] is False


@pytest.mark.parametrize("body", [
    {"kind": "tender", "features": {"est_value": -1, "n_bidders": 1}},
    {"kind": "tender", "features": {"est_value": 1000, "n_bidders": 1, "method": "secret"}},
    {"kind": "bid", "features": {}},
    {"kind": "contract", "features": {"contract_value": 100, "n_milestones": 0, "milestones_completed": 0, "paid_ratio": 0}},
])
def test_invalid_input_is_rejected(body):
    assert client.post("/score", json=body).status_code == 422


def test_scores_are_reproducible():
    a = client.post("/score", json=tender(n_bidders=1)).json()
    b = client.post("/score", json=tender(n_bidders=1)).json()
    assert a == b
