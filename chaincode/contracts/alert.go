package contracts

import (
	"encoding/json"
	"fmt"
	"slices"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

// Alert statuses. The regulator's decisions follow Chapter 3, 3.5.8: cleared, monitor or refer.
const (
	AlertOpen     = "OPEN"     // raised, not yet reviewed
	AlertCleared  = "CLEARED"  // reviewed: no concern
	AlertMonitor  = "MONITOR"  // reviewed: keep watching, may proceed
	AlertReferred = "REFERRED" // reviewed: referred for investigation (e.g. to the ACC)
)

// HighRiskScore is the score from which an alert flags its subject as high risk (Chapter 3, 3.5.6 and 3.5.7).
const HighRiskScore = 70

// An alert flags its subject while it is unreviewed or referred; a cleared or monitored alert does not.
var flaggingStatuses = []string{AlertOpen, AlertReferred}

var subjectTypes = []string{"tender", "contract"}

// Alert is an AI risk flag. The full SHAP explanation is stored off-chain; its hash is here.
type Alert struct {
	DocType         string `json:"docType"`
	ID              string `json:"id"`
	SubjectType     string `json:"subjectType"` // tender or contract
	SubjectID       string `json:"subjectId"`
	Score           int    `json:"score"` // 0–100; an integer so every peer agrees exactly
	ModelVersion    string `json:"modelVersion"`
	ExplanationHash string `json:"explanationHash"`
	Status          string `json:"status"`
	RaisedAt        string `json:"raisedAt"`
	ReviewerRef     string `json:"reviewerRef,omitempty" metadata:",optional"`
	ReviewerMSP     string `json:"reviewerMsp,omitempty" metadata:",optional"`
	ReasonHash      string `json:"reasonHash,omitempty" metadata:",optional"`
	ReviewedAt      string `json:"reviewedAt,omitempty" metadata:",optional"`
}

// AlertContract records AI risk alerts and how regulators and auditors dealt with them.
type AlertContract struct {
	contractapi.Contract
}

// RaiseAlert records a risk alert from the AI service (FR-AI-03).
func (c *AlertContract) RaiseAlert(ctx contractapi.TransactionContextInterface, alertID string,
	subjectType string, subjectID string, score int, modelVersion string, explanationHash string) error {
	if err := requireAccess(ctx, []string{MSPZPPA}, RoleAI); err != nil {
		return err
	}
	if err := checkID("alert ID", alertID); err != nil {
		return err
	}
	if !slices.Contains(subjectTypes, subjectType) {
		return fmt.Errorf("subject type must be tender or contract")
	}
	if err := checkID("subject ID", subjectID); err != nil {
		return err
	}
	if score < 0 || score > 100 {
		return fmt.Errorf("score must be between 0 and 100")
	}
	if err := checkID("model version", modelVersion); err != nil {
		return err
	}
	if err := checkHash("explanation hash", explanationHash); err != nil {
		return err
	}
	k, err := key(ctx, typeAlert, subjectID, alertID)
	if err != nil {
		return err
	}
	if exists, err := getJSON(ctx, k, &Alert{}); err != nil {
		return err
	} else if exists {
		return fmt.Errorf("alert %s already exists", alertID)
	}
	now, err := txTime(ctx)
	if err != nil {
		return err
	}
	a := &Alert{DocType: typeAlert, ID: alertID, SubjectType: subjectType, SubjectID: subjectID, Score: score,
		ModelVersion: modelVersion, ExplanationHash: explanationHash, Status: AlertOpen, RaisedAt: formatTime(now)}
	if err := putJSON(ctx, k, a); err != nil {
		return err
	}
	return emit(ctx, "AlertRaised", a)
}

// ReviewAlert records a regulator's decision on an alert: cleared, monitor or refer (Chapter 3, 3.5.8).
// An open alert can take any decision; a monitored one can later be cleared or referred;
// a referred one can be cleared once the investigation ends. Cleared is final.
// Regulators sit at ZPPA (role "regulator") and the Office of the Auditor General (role "auditor").
func (c *AlertContract) ReviewAlert(ctx contractapi.TransactionContextInterface,
	subjectID string, alertID string, decision string, reasonHash string) error {
	if err := requireAccess(ctx, []string{MSPZPPA, MSPOAG}, RoleRegulator, RoleAuditor); err != nil {
		return err
	}
	if err := checkHash("reason hash", reasonHash); err != nil {
		return err
	}
	allowed := map[string][]string{
		AlertOpen:     {AlertCleared, AlertMonitor, AlertReferred},
		AlertMonitor:  {AlertCleared, AlertReferred},
		AlertReferred: {AlertCleared},
	}
	k, err := key(ctx, typeAlert, subjectID, alertID)
	if err != nil {
		return err
	}
	a := &Alert{}
	if exists, err := getJSON(ctx, k, a); err != nil {
		return err
	} else if !exists {
		return fmt.Errorf("alert %s does not exist for %s", alertID, subjectID)
	}
	if !slices.Contains(allowed[a.Status], decision) {
		return fmt.Errorf("an alert that is %s cannot become %q", a.Status, decision)
	}
	now, err := txTime(ctx)
	if err != nil {
		return err
	}
	ref, err := callerRef(ctx)
	if err != nil {
		return err
	}
	a.Status, a.ReasonHash, a.ReviewedAt = decision, reasonHash, formatTime(now)
	a.ReviewerRef, a.ReviewerMSP = ref, callerMSP(ctx)
	if err := putJSON(ctx, k, a); err != nil {
		return err
	}
	return emit(ctx, "AlertReviewed", a)
}

// highRiskFlag returns a reason if any of the subjects has an alert that flags it as high risk, or "" if none does.
func highRiskFlag(ctx contractapi.TransactionContextInterface, subjectIDs ...string) (string, error) {
	for _, id := range subjectIDs {
		alerts, err := alertsFor(ctx, id)
		if err != nil {
			return "", err
		}
		for _, a := range alerts {
			if a.Score >= HighRiskScore && slices.Contains(flaggingStatuses, a.Status) {
				return fmt.Sprintf("%s %s is flagged as high risk (alert %s, score %d, %s)",
					a.SubjectType, id, a.ID, a.Score, a.Status), nil
			}
		}
	}
	return "", nil
}

// GetAllAlerts lists every alert on the ledger, for regulators to review (Chapter 3, 3.5.8).
func (c *AlertContract) GetAllAlerts(ctx contractapi.TransactionContextInterface) ([]*Alert, error) {
	return alertsFor(ctx)
}

// GetAlertsForSubject lists the alerts on a tender or contract in key order.
func (c *AlertContract) GetAlertsForSubject(ctx contractapi.TransactionContextInterface, subjectID string) ([]*Alert, error) {
	return alertsFor(ctx, subjectID)
}

// alertsFor lists the alerts on the given subject, or every alert when no subject is given.
func alertsFor(ctx contractapi.TransactionContextInterface, subjectID ...string) ([]*Alert, error) {
	it, err := ctx.GetStub().GetStateByPartialCompositeKey(typeAlert, subjectID)
	if err != nil {
		return nil, err
	}
	defer it.Close()
	out := []*Alert{}
	for it.HasNext() {
		kv, err := it.Next()
		if err != nil {
			return nil, err
		}
		a := &Alert{}
		if err := json.Unmarshal(kv.Value, a); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, nil
}
