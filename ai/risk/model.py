"""Scoring and plain-English explanations for one tender or contract (Chapter 3, 3.5.7). Used by the service.

score   = the three models combined (risk/scoring.py), 0-100
reasons = the factors that raised the score most, in plain English: from SHAP values of the supervised model,
          plus the graph model's and the unusualness model's own reasons when they contribute. They explain the
          score; they are not findings of wrongdoing.
"""
import math
import os

import joblib
import numpy as np
import pandas as pd
import shap

from risk import graph
from risk.features import contract_frame, tender_frame, value_band
from risk.scoring import THRESHOLD, combine, tail

TOP = 3  # factors shown (NFR: top 3 risk factors in plain English)
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def kw(x):
    return f"K{x:,.0f}"


class RiskModels:
    def __init__(self, model_dir):
        self.t = joblib.load(os.path.join(model_dir, "tender_model.joblib"))
        self.c = joblib.load(os.path.join(model_dir, "contract_model.joblib"))
        self.version = self.t["version"]
        self.t_explainer = shap.TreeExplainer(self.t["clf"])
        self.c_explainer = shap.TreeExplainer(self.c["clf"])

    # ---------- Tenders ----------
    def tender_row(self, f):
        """Raw service input -> the columns the feature builder expects."""
        est = f.get("est_value")
        award = f.get("award_value")
        ratio = award / est if est and award else None
        if ratio is not None and not (0.1 <= ratio <= 10):
            ratio = None  # treated as a data error, as in training
        ctx = self.t["context"]
        return {
            "log_est_value": math.log10(est) if est else None, "value_band": value_band(est, ctx["band_edges"]),
            "n_bidders": f.get("n_bidders"), "period_days": f.get("period_days"), "end_weekday": f.get("end_weekday"),
            "award_ratio": ratio, "decision_days": f.get("decision_days"), "buyer_n_awards": f.get("buyer_n_awards", 0),
            "supplier_wins": f.get("supplier_wins", 0), "buyer_supplier_share": f.get("buyer_supplier_share"),
            "pair_awards_same_month": f.get("pair_awards_same_month", 0),
            "method": f.get("method", "open"), "category": f.get("category", "unknown"),
        }

    def score_tender(self, f, explain=False):
        m = self.t
        X = tender_frame(pd.DataFrame([self.tender_row(f)]))
        p = float(m["clf"].predict_proba(X)[0, 1])
        medians = pd.Series(m["medians"])
        if_raw = -m["iforest"].score_samples(X.fillna(medians))[0]
        if_pct = float(np.searchsorted(m["if_scale"], if_raw, side="right") / len(m["if_scale"]))
        bidders = f.get("bidders") or []
        gf = graph.tender_features(m["graph_net"], bidders, f.get("winner"))
        # The graph model needs at least two known bidders; otherwise it has no evidence either way
        g_pct = graph.percentile(m["graph_scale"], graph.raw_graph_risk(gf)) if len(set(bidders)) >= 2 else None
        a_if, a_graph = float(tail(if_pct)), (float(tail(g_pct)) if g_pct is not None else 0.0)
        score = float(combine(p, a_if, a_graph))
        out = self._result(score, p, if_pct, g_pct)
        if explain:
            out["reasons"] = self._tender_reasons(f, X, a_if, if_pct, a_graph, gf)
        return out

    def _tender_reasons(self, f, X, a_if, if_pct, a_graph, gf):
        ctx = self.t["context"]
        row = X.iloc[0]
        band = row["value_band"]
        sv = np.ravel(self.t_explainer.shap_values(X))
        reasons = []
        for name, impact in sorted(zip(X.columns, sv), key=lambda z: -z[1]):
            if impact <= 0 or len(reasons) >= TOP:
                break
            text = self._tender_text(name, row, band, ctx, f)
            if text:
                reasons.append({"factor": name, "text": text, "impact": round(float(impact), 3), "model": "supervised"})
        if a_graph > 0:
            parts = []
            if gf["g_rivals_in_winner_group"]:
                parts.append(f"{int(gf['g_rivals_in_winner_group'])} rival(s) belong to the winner's close bidding group")
            if gf["g_repeat_losers"]:
                parts.append(f"{int(gf['g_repeat_losers'])} rival(s) have lost to this winner at least 3 times before")
            if gf["g_max_pair_cobids"]:
                parts.append(f"two of the bidders have bid together on {int(gf['g_max_pair_cobids'])} other tenders")
            reasons.append({"factor": "bidder_network", "model": "graph", "impact": round(a_graph, 3),
                            "text": "Links between competing bidders: " + "; ".join(parts) + "."})
        if a_if > 0:
            reasons.append({"factor": "unusual_combination", "model": "unsupervised", "impact": round(a_if, 3),
                            "text": f"Unusual combination of details compared with other ZPPA tenders (more unusual than {if_pct:.1%} of them)."})
        return reasons

    @staticmethod
    def _tender_text(name, row, band, ctx, f):
        v = row[name]
        if v is None or (isinstance(v, float) and math.isnan(v)):
            return None
        typical_bidders = ctx["bidders_by_band"].get(band) if band == band else None
        typical_period = ctx["period_by_band"].get(band) if band == band else None
        # A comparison is a reason only when this tender is worse than typical for its size
        if name == "n_bidders":
            if typical_bidders and v >= typical_bidders:
                return "Only 1 bidder." if v == 1 else None
            t = f" (typical for tenders of this size: {typical_bidders:.0f})" if typical_bidders else ""
            return f"Only 1 bidder{t}." if v == 1 else f"Only {v:.0f} bidders{t}."
        if name == "award_ratio":
            if v > 1.1:
                return f"Awarded at {v:.0%} of the estimate: {v - 1:.0%} above it."
            if v < 0.7:
                return f"Awarded at only {v:.0%} of the estimate: far below it, which can signal an unrealistic bid."
            return f"Awarded at {v:.0%} of the estimate."
        if name == "period_days":
            if typical_period and v >= typical_period:
                return None
            t = f" (typical for tenders of this size: {typical_period:.0f} days)" if typical_period else ""
            return f"Open for bids for only {v:.0f} day(s){t}."
        if name == "buyer_supplier_share":
            return f"This supplier has won {v:.0%} of this buyer's awards."
        if name == "pair_awards_same_month":
            return f"{v:.0f} awards from this buyer to this supplier in the same month, which can signal a purchase split to avoid open competition." if v > 1 else None
        if name == "supplier_wins":
            return f"The supplier has won {v:.0f} government awards."
        if name in ("log_est_value", "value_band"):
            est = f.get("est_value")
            if not est:
                return None
            for edge in ctx["band_edges"]:
                if 0.9 * edge <= est < edge:
                    return f"Estimated at {kw(est)}, just under the {kw(edge)} band limit."
            return f"Estimated at {kw(est)}."
        if name == "end_weekday":
            return f"Bidding closed on a {WEEKDAYS[int(v)]}." if v >= 5 else None
        if name == "decision_days":
            return f"Awarded {v:.0f} day(s) after closing."
        if name == "buyer_n_awards":
            return f"The buyer has made {v:.0f} awards."
        if name.startswith("method_") and v == 1:
            return f"Procurement method: {name.split('_', 1)[1]}."
        return None

    # ---------- Contracts ----------
    def score_contract(self, f, explain=False):
        m = self.c
        n = f.get("n_milestones") or 0
        row = {
            "log_contract_value": math.log10(f["contract_value"]) if f.get("contract_value") else None,
            "n_milestones": n, "completion_ratio": (f.get("milestones_completed", 0) / n) if n else None,
            "paid_ratio": f.get("paid_ratio"), "payments_before_completion": f.get("payments_before_completion", 0),
            "duplicate_payments": f.get("duplicate_payments", 0), "avg_days_late": f.get("avg_days_late", 0),
            "variation_recorded": int(bool(f.get("variation_recorded"))),
        }
        X = contract_frame(pd.DataFrame([row]))
        p = float(m["clf"].predict_proba(X)[0, 1])
        if_pct = float(np.searchsorted(m["if_scale"], -m["iforest"].score_samples(X.fillna(0))[0], side="right") / len(m["if_scale"]))
        score = float(combine(p, float(tail(if_pct)), 0.0))
        out = self._result(score, p, if_pct, None)
        if explain:
            sv = np.ravel(self.c_explainer.shap_values(X))
            reasons = []
            for name, impact in sorted(zip(X.columns, sv), key=lambda z: -z[1]):
                if impact <= 0 or len(reasons) >= TOP:
                    break
                text = self._contract_text(name, X.iloc[0][name])
                if text:
                    reasons.append({"factor": name, "text": text, "impact": round(float(impact), 3), "model": "supervised"})
            out["reasons"] = reasons
        return out

    @staticmethod
    def _contract_text(name, v):
        if v is None or (isinstance(v, float) and math.isnan(v)):
            return None
        return {
            "paid_ratio": f"Payments total {v:.0%} of the contract value." if v > 1 else f"{v:.0%} of the contract value paid so far.",
            "payments_before_completion": f"{v:.0f} payment(s) made before the milestone was certified complete." if v else None,
            "duplicate_payments": f"{v:.0f} duplicate payment(s)." if v else None,
            "avg_days_late": f"Milestones completed on average {v:.0f} day(s) late." if v > 0 else None,
            "completion_ratio": f"{v:.0%} of milestones completed.",
            "variation_recorded": "The contract value was varied." if v else None,
        }.get(name)

    def _result(self, score, p, if_pct, g_pct):
        return {
            "score": round(score), "alert": score >= THRESHOLD, "threshold": THRESHOLD, "modelVersion": self.version,
            "components": {"supervised": round(p, 4), "unsupervisedPercentile": round(if_pct, 4),
                           "graphPercentile": round(g_pct, 4) if g_pct is not None else None},
        }
