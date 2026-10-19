"""Train and evaluate the risk models (Chapter 3, 3.5.7): supervised, unsupervised and graph-based.

Usage (from the repository root): python ai/risk/train.py
Reads ai/data/processed/{tenders.csv, synthetic_tenders.csv, synthetic_contracts.csv, bids.csv}.
Writes ai/models/{tender_model.joblib, contract_model.joblib, metrics.json} and docs/phase4/model-evaluation.md.
Fixed seeds throughout, so Colab and a local run give the same models.
"""
import json
import os
import sys
import time

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, IsolationForest
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import train_test_split

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from risk import graph  # noqa: E402
from risk.features import CONTRACT_FEATURES, TENDER_FEATURES, contract_frame, tender_frame  # noqa: E402
from risk.scoring import THRESHOLD, combine, tail  # noqa: E402

SEED = 42
VERSION = "risk-1.0.0"
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(ROOT, "ai", "data", "processed")
MODELS = os.path.join(ROOT, "ai", "models")
DOCS = os.path.join(ROOT, "docs", "phase4")


def log(*a):
    print(*a, flush=True)


def synthetic_cartel(rng, n_tenders=40, members=5):
    """A closed group that bids together and takes turns winning, as 'links between competing bidders'."""
    rows = []
    for i in range(n_tenders):
        group = rng.choice(members, size=rng.integers(3, members + 1), replace=False)
        winner = group[i % len(group)]
        for m in group:
            rows.append({"ocid": f"SYN-CARTEL-{i:03d}", "bidder": f"CARTEL-{m}", "won": int(m == winner)})
    return pd.DataFrame(rows)


def random_control(rng, bids, n_tenders=40):
    """Tenders of the same size made of bidders drawn at random from the real network."""
    pool = bids["bidder"].unique()
    rows = []
    for i in range(n_tenders):
        group = rng.choice(pool, size=rng.integers(3, 6), replace=False)
        for j, m in enumerate(group):
            rows.append({"ocid": f"SYN-CONTROL-{i:03d}", "bidder": m, "won": int(j == 0)})
    return pd.DataFrame(rows)


def main():
    t0 = time.time()
    rng = np.random.default_rng(SEED)
    tenders = pd.read_csv(os.path.join(DATA, "tenders.csv"), low_memory=False)
    syn = pd.read_csv(os.path.join(DATA, "synthetic_tenders.csv"))
    contracts = pd.read_csv(os.path.join(DATA, "synthetic_contracts.csv"))
    bids = pd.read_csv(os.path.join(DATA, "bids.csv"))
    log(f"data: {len(tenders):,} real tenders, {len(syn):,} synthetic tenders, {len(contracts):,} synthetic contracts, {len(bids):,} bids")

    # ---------- Graph-based model ----------
    log("graph: evaluating on an injected cartel ...")
    cartel, control = synthetic_cartel(rng), random_control(rng, bids)
    eval_net = graph.build(pd.concat([bids, cartel, control], ignore_index=True))
    eval_bids = pd.concat([cartel, control])
    eval_f = graph.features_for_all(eval_net, eval_bids, eval_bids["ocid"].unique())
    log("graph: fitting on the real ZPPA network ...")
    net = graph.build(bids)
    real_graph = graph.features_for_all(net, bids, tenders["ocid"])
    raw_real = real_graph.apply(graph.raw_graph_risk, axis=1).to_numpy()
    graph_scale = graph.fit_scale(raw_real)
    eval_pct = eval_f.apply(lambda r: graph.percentile(graph_scale, graph.raw_graph_risk(r)), axis=1)
    cartel_pct = eval_pct[eval_pct.index.str.startswith("SYN-CARTEL")]
    control_pct = eval_pct[eval_pct.index.str.startswith("SYN-CONTROL")]
    graph_metrics = {
        "groups": net["n_groups"], "linked_pairs": len(net["pair"]), "bidders": len(net["bidder_tenders"]),
        "cartel_in_top5pct": float((cartel_pct >= 0.95).mean()), "control_in_top5pct": float((control_pct >= 0.95).mean()),
        "cartel_median_percentile": float(cartel_pct.median()), "control_median_percentile": float(control_pct.median()),
    }
    log("graph:", graph_metrics)

    # ---------- Tender features ----------
    X_real = tender_frame(tenders)
    y_real = tenders["rule_label"].astype(int).to_numpy()
    syn_train, syn_test = train_test_split(syn, test_size=0.3, random_state=SEED, stratify=syn["pattern"])
    X_train = pd.concat([X_real, tender_frame(syn_train)], ignore_index=True)
    y_train = np.concatenate([y_real, syn_train["true_label"].astype(int).to_numpy()])

    # ---------- Leakage check: can a classifier tell synthetic clean tenders from real clean ones? ----------
    from sklearn.model_selection import cross_val_score
    # Compared with the real tenders the synthetic ones were copied from: awarded, no warning signs, no data errors
    pool = (tenders["has_award"] == 1) & (tenders["value_error"] == 0) & (tenders["risk_points"] == 0) \
        & tenders["supplier"].notna() & tenders["award_ratio"].notna()
    real_clean = X_real[pool.to_numpy()].sample(n=5000, random_state=SEED)
    syn_clean = tender_frame(syn[syn["pattern"] == "none"])
    leak_X = pd.concat([real_clean, syn_clean], ignore_index=True)
    leak_y = np.r_[np.zeros(len(real_clean)), np.ones(len(syn_clean))]
    leak_auc = float(cross_val_score(HistGradientBoostingClassifier(max_iter=100, random_state=SEED), leak_X, leak_y,
                                     cv=5, scoring="roc_auc").mean())
    log(f"leakage check: real vs synthetic clean tenders AUC = {leak_auc:.3f} (0.5 = indistinguishable)")

    # ---------- Supervised model ----------
    log("supervised: training gradient boosting ...")
    clf = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.1, max_leaf_nodes=31, l2_regularization=1.0,
                                         random_state=SEED)
    clf.fit(X_train, y_train)

    # ---------- Unsupervised model ----------
    log("unsupervised: training Isolation Forest on real tenders ...")
    medians = X_real.median(numeric_only=True).fillna(0)
    iforest = IsolationForest(n_estimators=200, max_samples=4096, random_state=SEED, n_jobs=-1)
    iforest.fit(X_real.fillna(medians))
    if_raw_real = -iforest.score_samples(X_real.fillna(medians))  # higher = more unusual
    if_scale = np.sort(if_raw_real)

    def score_frame(X, graph_pct):
        p = clf.predict_proba(X)[:, 1]
        if_pct = np.searchsorted(if_scale, -iforest.score_samples(X.fillna(medians)), side="right") / len(if_scale)
        return combine(p, tail(if_pct), tail(np.asarray(graph_pct))), p

    # ---------- Evaluation on held-out synthetic tenders (true labels) ----------
    X_test = tender_frame(syn_test)
    y_test = syn_test["true_label"].astype(int).to_numpy()
    test_score, test_p = score_frame(X_test, np.zeros(len(X_test)))
    by_pattern = {}
    for pattern, idx in syn_test.groupby("pattern").groups.items():
        rows = syn_test.index.get_indexer(idx)
        by_pattern[pattern] = {
            "n": int(len(rows)),
            "model_flagged": float((test_score[rows] >= THRESHOLD).mean()),
            "rules_flagged": float(syn_test.loc[idx, "rule_label"].astype(int).mean()),
        }
    tender_metrics = {
        "roc_auc": float(roc_auc_score(y_test, test_score)),
        "recall_at_threshold": float((test_score[y_test == 1] >= THRESHOLD).mean()),
        "false_positive_rate": float((test_score[y_test == 0] >= THRESHOLD).mean()),
        "rules_recall": float(syn_test.loc[syn_test["true_label"] == 1, "rule_label"].astype(int).mean()),
        "rules_false_positive_rate": float(syn_test.loc[syn_test["true_label"] == 0, "rule_label"].astype(int).mean()),
        "by_pattern": by_pattern,
    }
    real_score, _ = score_frame(X_real, [graph.percentile(graph_scale, r) for r in raw_real])
    tender_metrics["real_alert_rate"] = float((real_score >= THRESHOLD).mean())
    tender_metrics["real_alerts"] = int((real_score >= THRESHOLD).sum())
    log("tenders:", json.dumps(tender_metrics, indent=1))

    # Reference values for plain-English explanations (median bidders and tender period by value band)
    context = {
        "bidders_by_band": tenders.groupby("value_band")["n_bidders"].median().dropna().to_dict(),
        "period_by_band": tenders.groupby("value_band")["period_days"].median().dropna().to_dict(),
        "band_edges": [20000.0, 67100.0, 200000.0, 560600.0],
        "median_supplier_share": float(tenders["buyer_supplier_share"].median()),
    }

    # ---------- Contract models ----------
    log("contracts: training ...")
    c_train, c_test = train_test_split(contracts, test_size=0.3, random_state=SEED, stratify=contracts["pattern"])
    c_clf = HistGradientBoostingClassifier(max_iter=200, learning_rate=0.1, random_state=SEED)
    c_clf.fit(contract_frame(c_train), c_train["true_label"])
    c_clean = contract_frame(c_train[c_train["true_label"] == 0])
    c_iforest = IsolationForest(n_estimators=200, random_state=SEED).fit(c_clean)
    c_if_scale = np.sort(-c_iforest.score_samples(c_clean))
    Xc = contract_frame(c_test)
    c_score = combine(c_clf.predict_proba(Xc)[:, 1],
                      tail(np.searchsorted(c_if_scale, -c_iforest.score_samples(Xc), side="right") / len(c_if_scale)),
                      np.zeros(len(Xc)))
    yc = c_test["true_label"].to_numpy()
    contract_metrics = {
        "roc_auc": float(roc_auc_score(yc, c_score)),
        "recall_at_threshold": float((c_score[yc == 1] >= THRESHOLD).mean()),
        "false_positive_rate": float((c_score[yc == 0] >= THRESHOLD).mean()),
        "by_pattern": {p: float((c_score[c_test["pattern"].to_numpy() == p] >= THRESHOLD).mean())
                       for p in sorted(c_test["pattern"].unique())},
    }
    log("contracts:", json.dumps(contract_metrics, indent=1))

    # ---------- Save ----------
    os.makedirs(MODELS, exist_ok=True)
    joblib.dump({"version": VERSION, "features": TENDER_FEATURES, "clf": clf, "iforest": iforest, "if_scale": if_scale,
                 "medians": medians.to_dict(), "graph_net": net, "graph_scale": graph_scale, "context": context},
                os.path.join(MODELS, "tender_model.joblib"), compress=3)
    joblib.dump({"version": VERSION, "features": CONTRACT_FEATURES, "clf": c_clf, "iforest": c_iforest, "if_scale": c_if_scale},
                os.path.join(MODELS, "contract_model.joblib"), compress=3)
    metrics = {"version": VERSION, "seed": SEED, "threshold": THRESHOLD, "leakage_auc": leak_auc, "graph": graph_metrics,
               "tender": tender_metrics, "contract": contract_metrics, "seconds": round(time.time() - t0)}
    with open(os.path.join(MODELS, "metrics.json"), "w") as f:
        json.dump(metrics, f, indent=2)
    write_report(metrics)
    log(f"saved models {VERSION} in {metrics['seconds']} s")


def write_report(m):
    os.makedirs(DOCS, exist_ok=True)
    t, c, g = m["tender"], m["contract"], m["graph"]
    pct = lambda x: f"{100 * x:.1f}%"  # noqa: E731
    lines = [
        f"# Risk model evaluation ({m['version']})", "",
        f"Seed {m['seed']} · alert threshold {m['threshold']} · trained in {m['seconds']} s. Produced by `ai/risk/train.py`.", "",
        "## Tenders: held-out synthetic tenders with known labels", "",
        "| Measure | Combined model | Rules only (Phase 1 baseline) |", "|---|---:|---:|",
        f"| ROC-AUC | {t['roc_auc']:.3f} | – |",
        f"| Recall (risky tenders flagged) | {pct(t['recall_at_threshold'])} | {pct(t['rules_recall'])} |",
        f"| False positives (clean tenders flagged) | {pct(t['false_positive_rate'])} | {pct(t['rules_false_positive_rate'])} |", "",
        "| Pattern | Tenders | Flagged by the model | Flagged by the rules |", "|---|---:|---:|---:|",
    ]
    for p, v in sorted(t["by_pattern"].items()):
        lines.append(f"| {p} | {v['n']} | {pct(v['model_flagged'])} | {pct(v['rules_flagged'])} |")
    lines += ["", f"Across all real ZPPA tenders, the model would raise {t['real_alerts']:,} alerts ({pct(t['real_alert_rate'])} of them) for review.", "",
              "## Leakage check", "",
              f"A classifier trained to tell synthetic clean tenders from real clean ones scores ROC-AUC {m['leakage_auc']:.3f} "
              "(0.5 means it cannot tell them apart). A high value would mean the synthetic data carries tell-tale signs the "
              "models could learn instead of the risk patterns. The first training run had two such signs (award ratios not "
              "exactly 1.0, and missing bidder lists), found by reading the SHAP explanations; both were removed.", "",
              "## Graph-based model: links between competing bidders", "",
              f"The co-bidding network has {g['bidders']:,} bidders, {g['linked_pairs']:,} linked pairs (two or more shared tenders) and {g['groups']:,} groups.", "",
              "| Injected test | In the top 5% of graph risk | Median percentile |", "|---|---:|---:|",
              f"| Cartel: 5 bidders, 40 tenders, winners in turn | {pct(g['cartel_in_top5pct'])} | {pct(g['cartel_median_percentile'])} |",
              f"| Control: random real bidders, same sizes | {pct(g['control_in_top5pct'])} | {pct(g['control_median_percentile'])} |", "",
              "## Contracts: held-out synthetic contracts", "",
              "| Measure | Value |", "|---|---:|",
              f"| ROC-AUC | {c['roc_auc']:.3f} |", f"| Recall | {pct(c['recall_at_threshold'])} |", f"| False positives | {pct(c['false_positive_rate'])} |", "",
              "| Pattern | Flagged |", "|---|---:|"]
    lines += [f"| {p} | {pct(v)} |" for p, v in c["by_pattern"].items()]
    lines += ["", "## Limits", "",
              "- Labels for real tenders come from rules, and the evaluation uses injected synthetic patterns, not confirmed "
              "corruption cases. The results show that the models detect these patterns better than the rules do, not how "
              "well they would detect real corruption.",
              "- The synthetic patterns carry clear signals and the clean comparison tenders have no warning signs at all, so "
              "this test is easier than real life; expect lower recall and more false positives on real cases.",
              "- The graph model is tested with one injected cartel pattern (closed group, winners in turn); other collusion "
              "patterns (for example cover bidding by outsiders) are not tested."]
    with open(os.path.join(DOCS, "model-evaluation.md"), "w") as f:
        f.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
