# Risk model evaluation (risk-1.0.0)

Seed 42 · alert threshold 70 · trained in 84 s. Produced by `ai/risk/train.py`.

## Tenders: held-out synthetic tenders with known labels

| Measure | Combined model | Rules only (Phase 1 baseline) |
|---|---:|---:|
| ROC-AUC | 0.991 | – |
| Recall (risky tenders flagged) | 90.6% | 43.7% |
| False positives (clean tenders flagged) | 2.2% | 0.0% |

| Pattern | Tenders | Flagged by the model | Flagged by the rules |
|---|---:|---:|---:|
| favoured_supplier | 300 | 99.3% | 12.3% |
| inflated_award | 300 | 71.7% | 66.3% |
| none | 1500 | 2.2% | 0.0% |
| rushed_tender | 300 | 99.7% | 51.3% |
| single_bidder_high | 300 | 90.3% | 79.7% |
| split_purchase | 300 | 92.0% | 9.0% |

Across all real ZPPA tenders, the model would raise 7,909 alerts (4.4% of them) for review.

## Leakage check

A classifier trained to tell synthetic clean tenders from real clean ones scores ROC-AUC 0.644 (0.5 means it cannot tell them apart). A high value would mean the synthetic data carries tell-tale signs the models could learn instead of the risk patterns. The first training run had two such signs (award ratios not exactly 1.0, and missing bidder lists), found by reading the SHAP explanations; both were removed.

## Graph-based model: links between competing bidders

The co-bidding network has 23,928 bidders, 60,534 linked pairs (two or more shared tenders) and 417 groups.

| Injected test | In the top 5% of graph risk | Median percentile |
|---|---:|---:|
| Cartel: 5 bidders, 40 tenders, winners in turn | 100.0% | 99.5% |
| Control: random real bidders, same sizes | 0.0% | 69.6% |

## Contracts: held-out synthetic contracts

| Measure | Value |
|---|---:|
| ROC-AUC | 1.000 |
| Recall | 100.0% |
| False positives | 0.3% |

| Pattern | Flagged |
|---|---:|
| duplicate_payment | 100.0% |
| none | 0.3% |
| overpayment | 100.0% |
| payment_before_completion | 100.0% |

## Limits

- Labels for real tenders come from rules, and the evaluation uses injected synthetic patterns, not confirmed corruption cases. The results show that the models detect these patterns better than the rules do, not how well they would detect real corruption.
- The synthetic patterns carry clear signals and the clean comparison tenders have no warning signs at all, so this test is easier than real life; expect lower recall and more false positives on real cases.
- The graph model is tested with one injected cartel pattern (closed group, winners in turn); other collusion patterns (for example cover bidding by outsiders) are not tested.
