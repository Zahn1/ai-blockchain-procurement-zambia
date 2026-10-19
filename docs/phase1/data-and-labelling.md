# Data and labelling method

**Status:** Phase 1, 10 October 2026 · **Approach:** C (rule-based labels on real data + injected synthetic patterns)

## 1. Source

- **Dataset:** Zambia Public Procurement Authority (ZPPA) e-GP data in the Open Contracting Data Standard (OCDS), from the Open Contracting Partnership data registry, publication 3 (`full.jsonl.gz`, retrieved 10 October 2026). Licence: CC BY 4.0.
- **Size:** 178,732 contracting processes, August 2016 to May 2026 (95% from 2023 onwards).
- **Profile:** see `data-profile.md`.

### Known limitations
| Limitation | Effect on this project |
|---|---|
| No implementation data (milestones, payments) | Contract-stage risk uses synthetic data only |
| `mainProcurementCategory` empty | Category derived from the tender title by keywords |
| 96% of tenders are "limited"; median tender period 3 days | Method and period are not usable as flags on their own; they are judged against the value |
| Award values up to 149,800× the estimate | Ratios outside 0.1–10× are marked as data errors (6,693 rows), not fraud |
| Supplier IDs do not match PACRA | Suppliers are matched by name |
| Classified procurement excluded (PPA s.40(2)) | Results do not cover security or defence spending |
| No confirmed corruption cases | No ground-truth labels; see section 3 |

## 2. Features (`ai/scripts/build_dataset.py`)

One row per contracting process (37 columns). The main model inputs are:

| Feature | Meaning |
|---|---|
| `log_est_value`, `value_band` | Estimated value (log₁₀) and its quintile: bands split at K20,000 / K67,100 / K200,000 / K560,600 |
| `method`, `category` | Procurement method; goods, works, services or unknown |
| `n_bidders` | Number of tenderers |
| `period_days`, `end_weekday` | Tender period length; day of the week it closed |
| `award_ratio` | Award ÷ estimate (blank if a data error) |
| `decision_days` | Days from closing to award |
| `buyer_n_awards`, `supplier_wins` | How many awards the buyer made and the supplier won |
| `buyer_supplier_share` | Share of the buyer's awards that went to this supplier |
| `pair_awards_same_month` | Awards from this buyer to this supplier in the same month |

## 3. Labels

### 3.1 Rule-based labels on real data

Each red flag adds points; a total of **4 or more** gives `rule_label = 1`.

| Flag | Rule | Points | Real tenders flagged |
|---|---|---:|---:|
| Single bidder | `n_bidders = 1` | 1 | 59,284 |
| Single bidder, high value | single bidder and top two value bands | +2 | 18,343 |
| Short period | top value band and open ≤ 1 day | 1 | 7,520 |
| Award above estimate | ratio > 1.1 | 2 | 3,994 |
| Award far above estimate | ratio > 1.5 | +1 | 1,915 |
| Favoured supplier | buyer has ≥ 5 awards and > 50% go to this supplier | 2 | 48 |
| Weekend closing | closes on Saturday or Sunday | 1 | 2,742 |
| Budget exceeded | award > 1.1 × budget line | 1 | 2,826 |

**Result:** 5,420 of 178,732 tenders (3.0%) are labelled high-risk.

A short period is judged against the value because same-day tenders make up 12–25% of every value band, so a percentile cut-off cannot separate them.

### 3.2 Synthetic injected patterns (`ai/scripts/synth.py`)

Synthetic rows are made from 8,095 clean awarded tenders (no flags, no data errors):

- **Clean:** 5,000 copies with values varied by ±10%, `true_label = 0`.
- **Injected:** 5 × 1,000 copies, each with one pattern, `true_label = 1`.

| Pattern | What is changed | Caught by rules alone |
|---|---|---:|
| `single_bidder_high` | Top value band, one bidder | 77.4% |
| `inflated_award` | Award 1.25–2.5× the estimate | 68.3% |
| `rushed_tender` | Top value band, open 0–1 days, often closing late in the week | 50.8% |
| `favoured_supplier` | 55–90% of a buyer's awards go to one supplier | 10.4% |
| `split_purchase` | Value just under a band edge, 3–8 same-month awards to one supplier | 7.6% |
| `none` (clean) | Values varied by ±10% | 0.0% false positives |

**Contracts:** 10,000 synthetic contract summaries (milestones, completion, payments). 15% contain one anomaly:
- `overpayment`: 507
- `payment_before_completion`: 524
- `duplicate_payment`: 509

### 3.3 How each label is used (Phase 4)

| Model | Trained on | Evaluated on |
|---|---|---|
| Supervised classifier | Real data with `rule_label` + synthetic tenders with `true_label` | Held-out synthetic tenders (true labels), per pattern |
| Isolation Forest | Real data, unlabelled | Recall on synthetic patterns the rules miss |
| Contract model | Synthetic contracts | Held-out synthetic contracts |
| Baseline | Rules only (table above) | The models must beat it, above all on `favoured_supplier` and `split_purchase` |

**Threats to validity:**
- The supervised model can learn the rules back from `rule_label`, so evaluation uses only the synthetic true labels.
- The synthetic patterns reflect assumptions about fraud, not observed cases. Results show that the models can detect these patterns, not that they detect real corruption.

## 4. Reproducing

```bash
python3.11 ai/scripts/profile_ocds.py ai/data/raw/zppa-full.jsonl.gz docs/phase1/data-profile.md
python3.11 ai/scripts/build_dataset.py ai/data/raw/zppa-full.jsonl.gz ai/data/processed/tenders.csv
python3.11 ai/scripts/synth.py ai/data/processed/tenders.csv ai/data/processed
```

The synthetic generator uses a fixed seed (42). Running it twice gives byte-identical files:

| File | SHA-256 |
|---|---|
| `synthetic_tenders.csv` | `a2678960…5778` |
| `synthetic_contracts.csv` | `6dfbbaeb…6bf0` |

## Revision (Phase 4)

Reading the SHAP explanations of the first trained model showed two tell-tale signs of synthetic rows: pattern rows drew
a new award ratio near 1.0 while real awards very often equal the estimate exactly, and estimates were not rounded. The
generator now keeps the source tender's own award ratio for patterns that are not about price, and rounds estimates to
whole tens of kwacha. The tables above are from the regenerated data. See `docs/phase4/model-evaluation.md`.
