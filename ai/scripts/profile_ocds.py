"""Profile the ZPPA OCDS dataset to see which risk indicators it can support.

Usage: python3.11 ai/scripts/profile_ocds.py ai/data/raw/zppa-full.jsonl.gz docs/phase1/data-profile.md
Standard library only; streams the file so memory stays low.
"""
import gzip
import json
import statistics
import sys
from collections import Counter, defaultdict
from datetime import datetime


def get(obj, path):
    """Follow a dotted path through nested dicts; return None if any part is missing."""
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


def unwrap(line):
    """Accept a compiled release, a record, or a release package."""
    doc = json.loads(line)
    if "compiledRelease" in doc:
        return doc["compiledRelease"]
    if "records" in doc:
        return doc["records"][0].get("compiledRelease", {})
    if "releases" in doc:
        return doc["releases"][-1]
    return doc


FIELDS = [
    "buyer.name", "tender.title", "tender.procurementMethod", "tender.procurementMethodDetails",
    "tender.mainProcurementCategory", "tender.value.amount", "tender.tenderPeriod.startDate",
    "tender.tenderPeriod.endDate", "tender.numberOfTenderers", "tender.tenderers", "tender.status",
    "awards", "contracts", "planning.budget.amount",
]


def pct(n, d):
    return f"{100 * n / d:.1f}%" if d else "n/a"


def describe(values):
    if not values:
        return "no data"
    q = statistics.quantiles(values, n=4) if len(values) > 1 else [values[0]] * 3
    return f"n={len(values):,} · min {min(values):,.0f} · median {q[1]:,.0f} · p75 {q[2]:,.0f} · max {max(values):,.0f}"


def main(src, out):
    total = 0
    present = Counter()
    methods, details, categories, statuses, currencies, years = (Counter() for _ in range(6))
    bidders, periods_days, tender_values, award_values, ratio = [], [], [], [], []
    buyer_suppliers = defaultdict(Counter)
    sample_keys = None

    with gzip.open(src, "rt", encoding="utf-8") as f:
        for line in f:
            r = unwrap(line)
            total += 1
            if sample_keys is None:
                sample_keys = sorted(r.keys())
            for p in FIELDS:
                v = get(r, p)
                if v not in (None, "", []):
                    present[p] += 1

            t = r.get("tender") or {}
            methods[t.get("procurementMethod")] += 1
            details[t.get("procurementMethodDetails")] += 1
            categories[t.get("mainProcurementCategory")] += 1
            statuses[t.get("status")] += 1
            if (d := parse_date(r.get("date"))):
                years[d.year] += 1

            n = t.get("numberOfTenderers")
            if n is None and t.get("tenderers"):
                n = len(t["tenderers"])
            if isinstance(n, int):
                bidders.append(n)

            s, e = parse_date(get(t, "tenderPeriod.startDate")), parse_date(get(t, "tenderPeriod.endDate"))
            if s and e and e >= s:
                periods_days.append((e - s).days)

            tv = get(t, "value.amount")
            if isinstance(tv, (int, float)) and tv > 0:
                tender_values.append(tv)
                currencies[get(t, "value.currency")] += 1

            buyer = get(r, "buyer.name") or "unknown"
            for a in r.get("awards") or []:
                av = get(a, "value.amount")
                if isinstance(av, (int, float)) and av > 0:
                    award_values.append(av)
                    if isinstance(tv, (int, float)) and tv > 0:
                        ratio.append(av / tv)
                for sup in a.get("suppliers") or []:
                    buyer_suppliers[buyer][sup.get("name") or sup.get("id")] += 1

    single = sum(1 for b in bidders if b == 1)
    short = sum(1 for d in periods_days if d < 14)
    over = sum(1 for x in ratio if x > 1.0)

    # Supplier concentration: share of a buyer's awards that go to its top supplier
    conc = []
    for buyer, sups in buyer_suppliers.items():
        n_awards = sum(sups.values())
        if n_awards >= 10:
            conc.append((buyer, n_awards, sups.most_common(1)[0][1] / n_awards))
    conc.sort(key=lambda x: -x[2])

    L = []
    w = L.append
    w("# ZPPA OCDS data profile\n")
    w(f"Generated {datetime.now():%d %B %Y %H:%M} from `{src.split('/')[-1]}` "
      "(Open Contracting Partnership data registry, publication 3, CC BY 4.0).\n")
    w(f"**Contracting processes:** {total:,}\n")
    w(f"Top-level keys: `{', '.join(sample_keys or [])}`\n")
    w("## Field coverage\n\n| Field | Present | Coverage |\n|---|---:|---:|")
    for p in FIELDS:
        w(f"| `{p}` | {present[p]:,} | {pct(present[p], total)} |")
    for title, c in [("Processes by year", years), ("Procurement method", methods),
                     ("Method details (top 10)", details), ("Main category", categories),
                     ("Tender status", statuses), ("Currency", currencies)]:
        w(f"\n## {title}\n\n| Value | Count | Share |\n|---|---:|---:|")
        items = sorted(c.items()) if title.startswith("Processes") else c.most_common(10)
        for k, v in items:
            w(f"| {k} | {v:,} | {pct(v, total)} |")
    w("\n## Numeric distributions\n")
    w(f"- Bidders per tender: {describe(bidders)}")
    w(f"- Tender period (days): {describe(periods_days)}")
    w(f"- Tender value (ZMW): {describe(tender_values)}")
    w(f"- Award value (ZMW): {describe(award_values)}")
    w(f"- Award ÷ tender value: {describe(ratio)}")
    w("\n## Red-flag feasibility\n\n| Indicator | Computable on | Flagged |\n|---|---:|---:|")
    w(f"| Single bidder | {len(bidders):,} ({pct(len(bidders), total)}) | {single:,} ({pct(single, len(bidders))}) |")
    w(f"| Short tender period (< 14 days) | {len(periods_days):,} ({pct(len(periods_days), total)}) | {short:,} ({pct(short, len(periods_days))}) |")
    w(f"| Award above estimate | {len(ratio):,} ({pct(len(ratio), total)}) | {over:,} ({pct(over, len(ratio))}) |")
    noncomp = sum(v for k, v in methods.items() if k in ("limited", "direct"))
    w(f"| Non-open method (limited/direct) | {total:,} | {noncomp:,} ({pct(noncomp, total)}) |")
    w(f"| Supplier concentration (buyers with ≥10 awards) | {len(conc):,} buyers | {sum(1 for c in conc if c[2] > 0.5):,} with top supplier > 50% |")
    w("\n## Most concentrated buyers (≥10 awards)\n\n| Buyer | Awards | Top-supplier share |\n|---|---:|---:|")
    for b, n, s in conc[:10]:
        w(f"| {b} | {n} | {s:.0%} |")

    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")
    print("\n".join(L))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
