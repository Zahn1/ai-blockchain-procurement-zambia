"""AI risk service (Chapter 3, 3.5.7): POST /score and POST /explain for tenders and contracts.

Run (from ai/): .venv/bin/uvicorn service.app:app --host 127.0.0.1 --port 8000
"""
import os
from typing import Annotated, Literal, Union

from fastapi import Body, FastAPI
from pydantic import BaseModel, Field

from risk.model import RiskModels

MODEL_DIR = os.environ.get("MODEL_DIR", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models"))
models = RiskModels(MODEL_DIR)

app = FastAPI(title="Procurement risk service", version=models.version,
              description="Risk scores (0-100) and plain-English explanations for tenders and contracts.")


class TenderFeatures(BaseModel):
    est_value: float = Field(gt=0, description="Estimated value in kwacha")
    n_bidders: int = Field(ge=0)
    period_days: float | None = Field(default=None, ge=0, description="Days the tender was open")
    end_weekday: int | None = Field(default=None, ge=0, le=6, description="0 = Monday")
    award_value: float | None = Field(default=None, gt=0, description="Awarded amount in kwacha, if awarded")
    decision_days: float | None = None
    buyer_n_awards: int = Field(default=0, ge=0)
    supplier_wins: int = Field(default=0, ge=0)
    buyer_supplier_share: float | None = Field(default=None, ge=0, le=1)
    pair_awards_same_month: int = Field(default=0, ge=0)
    method: Literal["open", "limited", "selective"] = "open"
    category: Literal["goods", "works", "services", "unknown"] = "unknown"
    bidders: list[str] = Field(default_factory=list, description="Anonymised bidder IDs (graph model)")
    winner: str | None = None


class ContractFeatures(BaseModel):
    contract_value: float = Field(gt=0)
    n_milestones: int = Field(ge=1)
    milestones_completed: int = Field(ge=0)
    paid_ratio: float = Field(ge=0)
    payments_before_completion: int = Field(default=0, ge=0)
    duplicate_payments: int = Field(default=0, ge=0)
    avg_days_late: float = 0
    variation_recorded: bool = False


class TenderRequest(BaseModel):
    kind: Literal["tender"]
    features: TenderFeatures


class ContractRequest(BaseModel):
    kind: Literal["contract"]
    features: ContractFeatures


Request = Annotated[Union[TenderRequest, ContractRequest], Field(discriminator="kind")]


def run(req, explain):
    f = req.features.model_dump()
    return models.score_tender(f, explain) if req.kind == "tender" else models.score_contract(f, explain)


@app.get("/health")
def health():
    return {"status": "ok", "modelVersion": models.version}


@app.post("/score")
def score(req: Annotated[Request, Body()]):
    """The risk score (0-100), whether it reaches the alert threshold, and each model's contribution."""
    return run(req, explain=False)


@app.post("/explain")
def explain(req: Annotated[Request, Body()]):
    """The score with its main risk factors in plain English."""
    return run(req, explain=True)
