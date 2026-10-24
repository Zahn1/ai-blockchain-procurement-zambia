"""Scores the usability sessions (Phase 6): SUS for each participant and task success rates.

Reads results.csv (one row per participant, filled in from the observation sheet and questionnaire) and writes
results.md. Task result codes: S succeeded unaided, H succeeded with help, F failed. SUS answers are 1-5.
Run: python3 docs/phase6/usability/score.py
"""
import csv
import statistics
from pathlib import Path

HERE = Path(__file__).parent
TASKS = 8
NAMES = ["Publish a tender", "Submit a bid and keep proof", "Check an altered document", "Why a payment is outstanding",
         "Find successful bids", "Review an alert", "Find dates and IFMIS reference in the history", "Find the winner and amount paid"]


def sus(answers):
    """SUS 0-100 (Brooke 1996): odd items score answer-1, even items 5-answer, total x 2.5."""
    if len(answers) != 10 or any(a not in range(1, 6) for a in answers):
        raise ValueError(f"SUS needs ten answers from 1 to 5, got {answers}")
    return 2.5 * sum(a - 1 if i % 2 == 0 else 5 - a for i, a in enumerate(answers))


def grade(score):
    """Adjective rating from Bangor, Kortum and Miller (2009)."""
    for limit, word in ((85.5, "excellent"), (72.75, "good"), (52.0, "OK"), (39.0, "poor")):
        if score >= limit:
            return word
    return "awful"


def main():
    rows = [r for r in csv.DictReader(open(HERE / "results.csv", newline="")) if r.get("participant", "").strip()]
    if not rows:
        print("results.csv has no participants yet.")
        return
    scores = [(r["participant"], sus([int(r[f"sus{i}"]) for i in range(1, 11)])) for r in rows]
    values = [s for _, s in scores]
    lines = ["# Usability results", "", f"{len(rows)} participants. Script: `docs/phase6/usability/score.py`.", "",
             "## System Usability Scale", "", "| Participant | Background | SUS | Rating |", "|---|---|---|---|"]
    lines += [f"| {p} | {r['background']} | {s:.1f} | {grade(s)} |" for (p, s), r in zip(scores, rows)]
    mean = statistics.mean(values)
    sd = statistics.stdev(values) if len(values) > 1 else 0.0
    lines += ["", f"**Mean SUS {mean:.1f}** (SD {sd:.1f}, range {min(values):.1f}–{max(values):.1f}): {grade(mean)}. "
              "The average across published studies is 68.", "",
              "## Tasks", "", "| Task | Unaided | With help | Failed | Success rate | Median time (s) |", "|---|---|---|---|---|---|"]
    for t in range(1, TASKS + 1):
        res = [r[f"t{t}_result"].strip().upper() for r in rows]
        secs = [float(r[f"t{t}_seconds"]) for r in rows if r[f"t{t}_seconds"].strip()]
        s, h, f = res.count("S"), res.count("H"), res.count("F")
        rate = (s + h) / len(res) * 100
        lines.append(f"| {t}. {NAMES[t - 1]} | {s} | {h} | {f} | {rate:.0f}% | {statistics.median(secs):.0f} |" if secs
                     else f"| {t}. {NAMES[t - 1]} | {s} | {h} | {f} | {rate:.0f}% | – |")
    lines += ["", "## Comments", ""]
    for r in rows:
        for key, label in (("easiest", "Easiest"), ("hardest", "Hardest"), ("trust_comment", "Trust")):
            if r.get(key, "").strip():
                lines.append(f"- {r['participant']}, {label.lower()}: “{r[key].strip()}”")
    (HERE / "results.md").write_text("\n".join(lines) + "\n")
    print(f"{len(rows)} participants, mean SUS {mean:.1f} ({grade(mean)}). Written to results.md")


if __name__ == "__main__":
    main()
