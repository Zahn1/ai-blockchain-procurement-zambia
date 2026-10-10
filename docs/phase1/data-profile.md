# ZPPA OCDS data profile

Generated 10 October 2026 12:44 from `zppa-full.jsonl.gz` (Open Contracting Partnership data registry, publication 3, CC BY 4.0).

**Contracting processes:** 178,732

Top-level keys: `awards, buyer, date, id, initiationType, language, ocid, parties, planning, tag, tender`

## Field coverage

| Field | Present | Coverage |
|---|---:|---:|
| `buyer.name` | 178,732 | 100.0% |
| `tender.title` | 178,674 | 100.0% |
| `tender.procurementMethod` | 178,674 | 100.0% |
| `tender.procurementMethodDetails` | 0 | 0.0% |
| `tender.mainProcurementCategory` | 0 | 0.0% |
| `tender.value.amount` | 178,674 | 100.0% |
| `tender.tenderPeriod.startDate` | 161,154 | 90.2% |
| `tender.tenderPeriod.endDate` | 178,663 | 100.0% |
| `tender.numberOfTenderers` | 178,672 | 100.0% |
| `tender.tenderers` | 126,746 | 70.9% |
| `tender.status` | 178,672 | 100.0% |
| `awards` | 28,244 | 15.8% |
| `contracts` | 12,568 | 7.0% |
| `planning.budget.amount` | 178,674 | 100.0% |

## Processes by year

| Value | Count | Share |
|---|---:|---:|
| 2016 | 12 | 0.0% |
| 2017 | 55 | 0.0% |
| 2018 | 259 | 0.1% |
| 2019 | 247 | 0.1% |
| 2020 | 57 | 0.0% |
| 2021 | 896 | 0.5% |
| 2022 | 4,166 | 2.3% |
| 2023 | 14,705 | 8.2% |
| 2024 | 47,224 | 26.4% |
| 2025 | 84,954 | 47.5% |
| 2026 | 26,157 | 14.6% |

## Procurement method

| Value | Count | Share |
|---|---:|---:|
| limited | 171,814 | 96.1% |
| open | 5,383 | 3.0% |
| selective | 1,477 | 0.8% |
| None | 58 | 0.0% |

## Method details (top 10)

| Value | Count | Share |
|---|---:|---:|
| None | 178,732 | 100.0% |

## Main category

| Value | Count | Share |
|---|---:|---:|
| None | 178,732 | 100.0% |

## Tender status

| Value | Count | Share |
|---|---:|---:|
| active | 122,960 | 68.8% |
| cancelled | 34,343 | 19.2% |
| planned | 17,255 | 9.7% |
| complete | 4,114 | 2.3% |
| None | 60 | 0.0% |

## Currency

| Value | Count | Share |
|---|---:|---:|
| ZMW | 169,368 | 94.8% |

## Numeric distributions

- Bidders per tender: n=178,672 · min 0 · median 1 · p75 2 · max 281
- Tender period (days): n=161,117 · min 0 · median 3 · p75 5 · max 377
- Tender value (ZMW): n=169,368 · min 0 · median 112,654 · p75 435,000 · max 9,817,177,000
- Award value (ZMW): n=30,009 · min 1 · median 28,610 · p75 121,184 · max 42,750,000,000
- Award ÷ tender value: n=28,792 · min 0 · median 1 · p75 1 · max 149,800

## Red-flag feasibility

| Indicator | Computable on | Flagged |
|---|---:|---:|
| Single bidder | 178,672 (100.0%) | 59,284 (33.2%) |
| Short tender period (< 14 days) | 161,117 (90.1%) | 147,341 (91.4%) |
| Award above estimate | 28,792 (16.1%) | 6,049 (21.0%) |
| Non-open method (limited/direct) | 178,732 | 171,814 (96.1%) |
| Supplier concentration (buyers with ≥10 awards) | 378 buyers | 5 with top supplier > 50% |

## Most concentrated buyers (≥10 awards)

| Buyer | Awards | Top-supplier share |
|---|---:|---:|
| ZAMBIA CORRECTIONAL SERVICE SERENJE CORRETIONAL CENTRE | 23 | 70% |
| Ministry of Tourism - Copperbelt And North Western Region(Department of National Parks and Wildlife) | 16 | 56% |
| St Luke's Mission Hospital- Mpanshya | 28 | 54% |
| Thomson District Hospital | 19 | 53% |
| LIVINGSTONE INSTITUTE OF BUSINESS AND ENGINEERING STUDIES | 77 | 51% |
| Zambia Postal Services Corporation | 11 | 45% |
| Chasefu District Health Office | 29 | 45% |
| ZAMBIA CORRECTIONAL SERVICE MILOSO CORRECTIONAL FARM | 14 | 43% |
| zambia correctional service mounted unit | 21 | 43% |
| Lukulu Town Council | 357 | 43% |
