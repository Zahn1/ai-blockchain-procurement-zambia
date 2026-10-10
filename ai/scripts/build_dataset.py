"""Flatten ZPPA OCDS data into one row per tender, add red-flag features and a rule-based label.

Usage: python3.11 ai/scripts/build_dataset.py ai/data/raw/zppa-full.jsonl.gz ai/data/processed/tenders.csv
Standard library only. Labelling method: docs/phase1/data-and-labelling.md
"""
import csv
import gzip
import json
import math
import statistics
import sys
from collections import Counter
from datetime import datetime

# Keyword rules for the category, since tender.mainProcurementCategory is empty in ZPPA data.
# Checked in order: works first, because "supply and installation" is treated as works.
CATEGORY_KEYWORDS = {
    "works": ["construction", "rehabilitation", "renovation", "building", "road", "borehole", "civil works",
              "installation", "drilling", "paving", "fencing", "bridge", "culvert", "maintenance of"],
    "services": ["consult", "service", "hire", "training", "cleaning", "security", "catering", "audit",
                 "transport", "insurance", "printing", "repair", "servicing", "accommodation", "design"],
    "goods": ["supply", "delivery", "procurement of", "purchase", "equipment", "drugs", "fuel", "stationery",
              "furniture", "vehicle", "computers", "materials", "uniforms", "food", "spares", "toner"],
}

RATIO_ERROR = (0.1, 10.0)  # award/estimate outside this range is treated as a data-entry error, not fraud
LABEL_THRESHOLD = 4        # points needed for rule_label = 1


def get(obj, path):
    for key in path.split("."):
        if not isinstance(obj, dict):
            return None
        obj = obj.get(key)
    return obj


def parse_date(s):
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except (AttributeError, ValueError):
        return None


def category(title):
    t = (title or "").lower()
    for cat, words in CATEGORY_KEYWORDS.items():
        if any(w in t for w in words):
            return cat
    return "unknown"


def number(x):
    return x if isinstance(x, (int, float)) and not isinstance(x, bool) else None


def extract(r):
    t = r.get("tender") or {}
    start, end = parse_date(get(t, "tenderPeriod.startDate")), parse_date(get(t, "tenderPeriod.endDate"))
    est = number(get(t, "value.amount"))
    n_bid = t.get("numberOfTenderers")
    if n_bid is None and t.get("tenderers"):
        n_bid = len(t["tenderers"])

    awards = r.get("awards") or []
    a = awards[0] if awards else {}
    sup = (a.get("suppliers") or [{}])[0]
    award_val = number(get(a, "value.amount"))
    award_date = parse_date(a.get("date"))
    published = parse_date(r.get("date"))

    return {
        "ocid": r.get("ocid"),
        "buyer": (get(r, "buyer.name") or "unknown").strip(),
        "year": published.year if published else None,
        "month": published.month if published else None,
        "method": t.get("procurementMethod"),
        "category": category(t.get("title")),
        "status": t.get("status"),
        "est_value": est if est and est > 0 else None,
        "currency": get(t, "value.currency"),
        "budget": number(get(r, "planning.budget.amount.amount")),  # OCDS Value object, one level deeper
        "n_bidders": n_bid if isinstance(n_bid, int) else None,
        "period_days": (end - start).days if start and end and end >= start else None,
        "end_weekday": end.weekday() if end else None,
        "has_award": int(bool(awards)),
        "n_awards": len(awards),
        "award_value": award_val if award_val and award_val > 0 else None,
        "supplier": (sup.get("name") or sup.get("id") or "").strip() or None,
        "decision_days": (award_date - end).days if award_date and end else None,
    }


def apply_flags(r):
    """Set the red-flag columns, risk_points and rule_label on a row. Shared with synth.py."""
    hi_value = r["value_band"] is not None and r["value_band"] >= 3
    r["flag_single_bidder"] = int(r["n_bidders"] == 1)
    r["flag_single_bidder_high_value"] = int(r["n_bidders"] == 1 and hi_value)
    # Same-day periods are common at every value (12-25%), so percentiles cannot separate them;
    # flag a top-quintile tender open for a day or less instead.
    r["flag_short_period"] = int(r["period_days"] is not None and r["value_band"] == 4 and r["period_days"] <= 1)
    r["flag_award_above_estimate"] = int(r["award_ratio"] is not None and r["award_ratio"] > 1.1)
    r["flag_award_far_above"] = int(r["award_ratio"] is not None and r["award_ratio"] > 1.5)
    r["flag_favoured_supplier"] = int(
        r["buyer_supplier_share"] is not None and r["buyer_n_awards"] >= 5 and r["buyer_supplier_share"] > 0.5)
    r["flag_weekend_close"] = int(r["end_weekday"] in (5, 6))
    r["flag_budget_exceeded"] = int(bool(r["budget"] and r["award_value"] and not r["value_error"]
                                         and r["award_value"] > 1.1 * r["budget"]))

    points = (2 * r["flag_single_bidder_high_value"] + r["flag_single_bidder"]
              + r["flag_short_period"] + 2 * r["flag_award_above_estimate"] + r["flag_award_far_above"]
              + 2 * r["flag_favoured_supplier"] + r["flag_weekend_close"] + r["flag_budget_exceeded"])
    r["risk_points"] = points
    r["rule_label"] = int(points >= LABEL_THRESHOLD)


def quintile_edges(values):
    return statistics.quantiles(values, n=5)  # 4 cut points → 5 bands


def band(v, edges):
    if v is None:
        return None
    return sum(v > e for e in edges)  # 0..4


def main(src, out):
    rows = []
    with gzip.open(src, "rt", encoding="utf-8") as f:
        for line in f:
            rows.append(extract(json.loads(line)))

    # Value bands: quintiles of the estimate
    edges = quintile_edges([r["est_value"] for r in rows if r["est_value"]])
    for r in rows:
        r["value_band"] = band(r["est_value"], edges)

    # Buyer–supplier relationships (awarded tenders only)
    buyer_awards = Counter()
    pair_awards = Counter()
    supplier_wins = Counter()
    pair_month = Counter()
    for r in rows:
        if r["supplier"]:
            pair_month[(r["buyer"], r["supplier"], r["year"], r["month"])] += 1
            buyer_awards[r["buyer"]] += 1
            pair_awards[(r["buyer"], r["supplier"])] += 1
            supplier_wins[r["supplier"]] += 1

    for r in rows:
        est, aw = r["est_value"], r["award_value"]
        ratio = aw / est if est and aw else None
        r["value_error"] = int(ratio is not None and not (RATIO_ERROR[0] <= ratio <= RATIO_ERROR[1]))
        r["award_ratio"] = round(ratio, 4) if ratio is not None and not r["value_error"] else None
        r["log_est_value"] = round(math.log10(est), 4) if est else None
        r["buyer_n_awards"] = buyer_awards[r["buyer"]]
        r["supplier_wins"] = supplier_wins[r["supplier"]] if r["supplier"] else 0
        r["buyer_supplier_share"] = (
            round(pair_awards[(r["buyer"], r["supplier"])] / buyer_awards[r["buyer"]], 4)
            if r["supplier"] else None)
        # Several awards to one supplier from one buyer in a month can indicate a split purchase
        r["pair_awards_same_month"] = (
            pair_month[(r["buyer"], r["supplier"], r["year"], r["month"])] if r["supplier"] else 0)
        apply_flags(r)
        r["source"] = "zppa"

    fields = list(rows[0].keys())
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)

    labelled = sum(r["rule_label"] for r in rows)
    print(f"rows {len(rows):,} · columns {len(fields)} · rule_label=1: {labelled:,} ({100 * labelled / len(rows):.1f}%)")
    print("value band edges (ZMW):", [f"{e:,.0f}" for e in edges])
    print("categories:", dict(Counter(r["category"] for r in rows).most_common()))
    print("value errors:", sum(r["value_error"] for r in rows))
    for k in [c for c in fields if c.startswith("flag_")]:
        print(f"  {k}: {sum(r[k] for r in rows):,}")
    print("risk_points:", dict(sorted(Counter(r["risk_points"] for r in rows).items())))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
