"""Generate labelled synthetic data from clean ZPPA tenders.

Tenders: copies of clean awarded tenders, half left clean (true_label 0) and half with one of five
injected fraud patterns (true_label 1). Contracts: milestone and payment summaries, since ZPPA
publishes no implementation data, with three injected payment anomalies.

Usage: python3.11 ai/scripts/synth.py ai/data/processed/tenders.csv ai/data/processed
Fixed seed, so every run gives the same output. Method: docs/phase1/data-and-labelling.md
"""
import csv
import math
import os
import random
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_dataset import apply_flags  # noqa: E402  (same rules as the real data)

SEED = 42
PER_PATTERN = 1000
CLEAN = 5000
CONTRACT_ANOMALY_RATE = 0.15

INT_COLS = {"year", "month", "n_bidders", "period_days", "end_weekday", "has_award", "n_awards", "decision_days",
            "value_band", "value_error", "buyer_n_awards", "supplier_wins", "pair_awards_same_month",
            "risk_points", "rule_label"}
FLOAT_COLS = {"est_value", "budget", "award_value", "award_ratio", "log_est_value", "buyer_supplier_share"}


def load(path):
    rows = []
    with open(path, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            for k in INT_COLS:
                r[k] = int(r[k]) if r[k] not in ("", None) else None
            for k in FLOAT_COLS:
                r[k] = float(r[k]) if r[k] not in ("", None) else None
            rows.append(r)
    return rows


def set_values(r, est, ratio):
    r["est_value"] = round(est, 2)
    r["log_est_value"] = round(math.log10(est), 4)
    r["award_ratio"] = round(ratio, 4)
    r["award_value"] = round(est * ratio, 2)


# Each pattern edits a copy of a clean tender. Value-band edges come from build_dataset output.
def single_bidder_high(r, rng, edges):
    set_values(r, rng.uniform(edges[3], edges[3] * 8), rng.uniform(0.97, 1.08))
    r["value_band"], r["n_bidders"] = 4, 1


def inflated_award(r, rng, edges):
    set_values(r, r["est_value"], rng.uniform(1.25, 2.5))
    r["n_bidders"] = rng.choice([1, 1, 2, 3])


def rushed_tender(r, rng, edges):
    set_values(r, rng.uniform(edges[3], edges[3] * 6), rng.uniform(0.98, 1.1))
    r["value_band"], r["period_days"], r["n_bidders"] = 4, rng.choice([0, 0, 1]), rng.choice([1, 2])
    r["end_weekday"] = rng.choice([4, 5, 6])


def favoured_supplier(r, rng, edges):
    r["buyer_n_awards"] = rng.randint(8, 60)
    r["buyer_supplier_share"] = round(rng.uniform(0.55, 0.9), 4)
    r["supplier_wins"] = max(r["supplier_wins"] or 0, int(r["buyer_n_awards"] * r["buyer_supplier_share"]))
    r["n_bidders"] = rng.choice([1, 2, 2, 3])


def split_purchase(r, rng, edges):
    # Just under a value-band edge, repeated with the same supplier in one month.
    # The rules have no flag for this, so it tests what the models add beyond the rules.
    edge = rng.choice(edges[1:])
    set_values(r, edge * rng.uniform(0.9, 0.995), rng.uniform(0.98, 1.02))
    r["value_band"] = edges.index(edge)
    r["pair_awards_same_month"] = rng.randint(3, 8)
    r["n_bidders"] = rng.choice([1, 1, 2])


PATTERNS = [single_bidder_high, inflated_award, rushed_tender, favoured_supplier, split_purchase]


def contract(r, rng, cid, anomaly):
    """One row per contract: milestone and payment summary features."""
    value = r["award_value"]
    n_ms = rng.randint(2, 5)
    completed = rng.randint(1, n_ms)
    paid_ratio = completed / n_ms * rng.uniform(0.95, 1.0)
    days_late = [max(0, int(rng.gauss(5, 10))) for _ in range(completed)]
    early_payments = duplicates = 0
    variation = int(rng.random() < 0.05)

    if anomaly == "overpayment":
        paid_ratio = rng.uniform(1.15, 1.6)
        variation = 0
    elif anomaly == "payment_before_completion":
        early_payments = rng.randint(1, max(1, n_ms - completed + 1))
        paid_ratio = min(1.0, (completed + early_payments) / n_ms)
    elif anomaly == "duplicate_payment":
        duplicates = rng.randint(1, 2)
        paid_ratio += duplicates / n_ms

    return {
        "contract_id": f"SYN-C-{cid:05d}", "ocid": r["ocid"], "category": r["category"],
        "contract_value": value, "log_contract_value": round(math.log10(value), 4),
        "n_milestones": n_ms, "milestones_completed": completed,
        "completion_ratio": round(completed / n_ms, 4), "paid_ratio": round(paid_ratio, 4),
        "payments_before_completion": early_payments, "duplicate_payments": duplicates,
        "avg_days_late": round(sum(days_late) / len(days_late), 2), "variation_recorded": variation,
        "pattern": anomaly or "none", "true_label": int(bool(anomaly)), "source": "synthetic",
    }


def main(src, out_dir):
    rng = random.Random(SEED)
    rows = load(src)
    # Band edges are the lowest estimate seen in each band
    lows = {}
    for r in rows:
        if r["value_band"] is not None and r["est_value"]:
            lows[r["value_band"]] = min(lows.get(r["value_band"], math.inf), r["est_value"])
    edges = [lows[b] for b in range(1, 5)]

    pool = [r for r in rows if r["has_award"] and r["supplier"] and not r["value_error"]
            and r["award_ratio"] and r["est_value"] and r["risk_points"] == 0]
    print(f"clean awarded pool: {len(pool):,} · value-band edges: {[round(e) for e in edges]}")

    out = []
    for i in range(CLEAN):
        r = dict(rng.choice(pool))
        set_values(r, r["est_value"] * rng.uniform(0.9, 1.1), r["award_ratio"])
        r["pattern"], r["true_label"] = "none", 0
        out.append(r)
    for fn in PATTERNS:
        for _ in range(PER_PATTERN):
            r = dict(rng.choice(pool))
            fn(r, rng, edges)
            r["pattern"], r["true_label"] = fn.__name__, 1
            out.append(r)
    for i, r in enumerate(out):
        r["ocid"] = f"SYN-{i:05d}"
        r["source"] = "synthetic"
        apply_flags(r)
    rng.shuffle(out)

    anomalies = ["overpayment", "payment_before_completion", "duplicate_payment"]
    contracts = [contract(r, rng, i, rng.choice(anomalies) if rng.random() < CONTRACT_ANOMALY_RATE else None)
                 for i, r in enumerate(out)]

    for name, data in [("synthetic_tenders.csv", out), ("synthetic_contracts.csv", contracts)]:
        with open(os.path.join(out_dir, name), "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(data[0].keys()))
            w.writeheader()
            w.writerows(data)

    print(f"synthetic tenders: {len(out):,} · contracts: {len(contracts):,}")
    print("\nHow well do the rules alone catch each pattern? (rule_label = 1)")
    for p in ["none"] + [fn.__name__ for fn in PATTERNS]:
        sub = [r for r in out if r["pattern"] == p]
        hit = sum(r["rule_label"] for r in sub)
        print(f"  {p:22s} {hit:5,} / {len(sub):,}  ({100 * hit / len(sub):.1f}%)")
    print("contract patterns:", dict(Counter(c["pattern"] for c in contracts)))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
