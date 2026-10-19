"""Extract the bidder network from ZPPA OCDS data: one row per (tender, bidder), and whether that bidder won.

Feeds the graph-based model (Chapter 3, 3.5.7: "links between competing bidders"). Only the anonymised bidder IDs
that ZPPA publishes are kept, not names.

Usage: python3.11 ai/scripts/build_bid_network.py ai/data/raw/zppa-full.jsonl.gz ai/data/processed/bids.csv
"""
import csv
import gzip
import json
import sys


def main(src, out):
    rows = 0
    tenders = 0
    with gzip.open(src, "rt", encoding="utf-8") as f, open(out, "w", newline="", encoding="utf-8") as o:
        w = csv.writer(o)
        w.writerow(["ocid", "bidder", "won"])
        for line in f:
            r = json.loads(line)
            tenderers = (r.get("tender") or {}).get("tenderers") or []
            if not tenderers:
                continue
            winners = {s.get("id") for a in r.get("awards") or [] for s in a.get("suppliers") or []}
            seen = set()
            for t in tenderers:
                bidder = t.get("id")
                if not bidder or bidder in seen:
                    continue
                seen.add(bidder)
                w.writerow([r["ocid"], bidder, int(bidder in winners)])
                rows += 1
            tenders += 1
    print(f"tenders with bidders: {tenders:,} · bid edges: {rows:,}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
