package contracts

import (
	"encoding/json"
	"fmt"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

// Milestone statuses.
const (
	MilestonePending   = "PENDING"
	MilestoneCompleted = "COMPLETED"
)

// Milestone is a deliverable in a signed contract, with the payments made against it.
type Milestone struct {
	DocType      string   `json:"docType"`
	ID           string   `json:"id"`
	AwardID      string   `json:"awardId"`
	Amount       int64    `json:"amount"` // ngwee
	DueDate      string   `json:"dueDate"`
	Status       string   `json:"status"`
	EvidenceHash string   `json:"evidenceHash,omitempty" metadata:",optional"`
	CompletedAt  string   `json:"completedAt,omitempty" metadata:",optional"`
	PaidTotal    int64    `json:"paidTotal"`
	PaymentIDs   []string `json:"paymentIds"`
}

// Payment is a payment recorded against a milestone, with its IFMIS reference.
type Payment struct {
	DocType     string `json:"docType"`
	ID          string `json:"id"`
	AwardID     string `json:"awardId"`
	MilestoneID string `json:"milestoneId"`
	Amount      int64  `json:"amount"` // ngwee
	IFMISRef    string `json:"ifmisRef"`
	PaidAt      string `json:"paidAt"`
	TxID        string `json:"txId"`
}

// MilestoneEvent is the payload of milestone and payment events.
type MilestoneEvent struct {
	AwardID     string `json:"awardId"`
	MilestoneID string `json:"milestoneId"`
	Status      string `json:"status"`
	Amount      int64  `json:"amount"`
	PaymentID   string `json:"paymentId,omitempty"`
	DocHash     string `json:"docHash,omitempty"`
	TxTime      string `json:"txTime"`
}

// MilestoneContract records contract milestones, their completion and the payments made.
type MilestoneContract struct {
	contractapi.Contract
}

// AddMilestone adds a milestone to a signed contract. All milestones together may not exceed the contract value.
func (c *MilestoneContract) AddMilestone(ctx contractapi.TransactionContextInterface,
	awardID string, milestoneID string, amount int64, dueDate string) error {
	if err := requireAccess(ctx, []string{MSPZPPA}, RoleOfficer); err != nil {
		return err
	}
	if err := checkID("milestone ID", milestoneID); err != nil {
		return err
	}
	if err := checkAmount("milestone amount", amount); err != nil {
		return err
	}
	due, err := parseTime(dueDate)
	if err != nil {
		return err
	}
	a, _, err := loadAward(ctx, awardID)
	if err != nil {
		return err
	}
	if a.Status != ContractSigned {
		return fmt.Errorf("award %s has no signed contract", awardID)
	}
	existing, err := milestonesFor(ctx, awardID)
	if err != nil {
		return err
	}
	var planned int64
	for _, m := range existing {
		if m.ID == milestoneID {
			return fmt.Errorf("milestone %s already exists", milestoneID)
		}
		planned += m.Amount
	}
	if planned+amount > a.ContractValue {
		return fmt.Errorf("milestones would total %d ngwee, above the contract value of %d", planned+amount, a.ContractValue)
	}
	now, err := txTime(ctx)
	if err != nil {
		return err
	}
	k, err := key(ctx, typeMilestone, awardID, milestoneID)
	if err != nil {
		return err
	}
	m := &Milestone{DocType: typeMilestone, ID: milestoneID, AwardID: awardID, Amount: amount,
		DueDate: formatTime(due), Status: MilestonePending, PaymentIDs: []string{}}
	if err := putJSON(ctx, k, m); err != nil {
		return err
	}
	return emit(ctx, "MilestoneAdded", MilestoneEvent{AwardID: awardID, MilestoneID: milestoneID,
		Status: m.Status, Amount: amount, TxTime: formatTime(now)})
}

// CompleteMilestone marks a milestone delivered, with the hash of the evidence (e.g. a signed delivery note).
func (c *MilestoneContract) CompleteMilestone(ctx contractapi.TransactionContextInterface,
	awardID string, milestoneID string, evidenceHash string) error {
	if err := requireAccess(ctx, []string{MSPZPPA}, RoleOfficer); err != nil {
		return err
	}
	if err := checkHash("evidence hash", evidenceHash); err != nil {
		return err
	}
	m, k, err := loadMilestone(ctx, awardID, milestoneID)
	if err != nil {
		return err
	}
	if m.Status != MilestonePending {
		return fmt.Errorf("milestone %s is already %s", milestoneID, m.Status)
	}
	now, err := txTime(ctx)
	if err != nil {
		return err
	}
	m.Status, m.EvidenceHash, m.CompletedAt = MilestoneCompleted, evidenceHash, formatTime(now)
	if err := putJSON(ctx, k, m); err != nil {
		return err
	}
	return emit(ctx, "MilestoneCompleted", MilestoneEvent{AwardID: awardID, MilestoneID: milestoneID,
		Status: m.Status, Amount: m.Amount, DocHash: evidenceHash, TxTime: m.CompletedAt})
}

// RecordPayment records a payment against a completed milestone (FR-MIL-03, FR-MIL-04).
// It refuses payment before completion, a reused payment ID, more than the milestone amount,
// and anything that would take total payments above the contract value.
func (c *MilestoneContract) RecordPayment(ctx contractapi.TransactionContextInterface,
	awardID string, milestoneID string, paymentID string, amount int64, ifmisRef string) error {
	if err := requireAccess(ctx, []string{MSPZPPA}, RoleOfficer); err != nil {
		return err
	}
	if err := checkID("payment ID", paymentID); err != nil {
		return err
	}
	if err := checkID("IFMIS reference", ifmisRef); err != nil {
		return err
	}
	if err := checkAmount("payment amount", amount); err != nil {
		return err
	}
	a, ak, err := loadAward(ctx, awardID)
	if err != nil {
		return err
	}
	m, mk, err := loadMilestone(ctx, awardID, milestoneID)
	if err != nil {
		return err
	}
	if m.Status != MilestoneCompleted {
		return fmt.Errorf("milestone %s is %s; payment is allowed only after completion", milestoneID, m.Status)
	}
	pk, err := key(ctx, typePayment, paymentID)
	if err != nil {
		return err
	}
	if exists, err := getJSON(ctx, pk, &Payment{}); err != nil {
		return err
	} else if exists {
		return fmt.Errorf("payment %s has already been recorded", paymentID)
	}
	if m.PaidTotal+amount > m.Amount {
		return fmt.Errorf("payment would bring milestone %s to %d ngwee, above its amount of %d",
			milestoneID, m.PaidTotal+amount, m.Amount)
	}
	if a.PaidTotal+amount > a.ContractValue {
		return fmt.Errorf("payment would bring the contract to %d ngwee, above its value of %d; record a variation first",
			a.PaidTotal+amount, a.ContractValue)
	}
	now, err := txTime(ctx)
	if err != nil {
		return err
	}

	p := &Payment{DocType: typePayment, ID: paymentID, AwardID: awardID, MilestoneID: milestoneID, Amount: amount,
		IFMISRef: ifmisRef, PaidAt: formatTime(now), TxID: ctx.GetStub().GetTxID()}
	m.PaidTotal += amount
	m.PaymentIDs = append(m.PaymentIDs, paymentID)
	a.PaidTotal += amount
	a.UpdatedAt = formatTime(now)
	for _, w := range []struct {
		k string
		v any
	}{{pk, p}, {mk, m}, {ak, a}} {
		if err := putJSON(ctx, w.k, w.v); err != nil {
			return err
		}
	}
	return emit(ctx, "PaymentRecorded", MilestoneEvent{AwardID: awardID, MilestoneID: milestoneID,
		Status: m.Status, Amount: amount, PaymentID: paymentID, TxTime: p.PaidAt})
}

// GetMilestones lists a contract's milestones in key order.
func (c *MilestoneContract) GetMilestones(ctx contractapi.TransactionContextInterface, awardID string) ([]*Milestone, error) {
	return milestonesFor(ctx, awardID)
}

// ReadPayment returns one payment.
func (c *MilestoneContract) ReadPayment(ctx contractapi.TransactionContextInterface, paymentID string) (*Payment, error) {
	k, err := key(ctx, typePayment, paymentID)
	if err != nil {
		return nil, err
	}
	p := &Payment{}
	exists, err := getJSON(ctx, k, p)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, fmt.Errorf("payment %s does not exist", paymentID)
	}
	return p, nil
}

func loadMilestone(ctx contractapi.TransactionContextInterface, awardID, milestoneID string) (*Milestone, string, error) {
	k, err := key(ctx, typeMilestone, awardID, milestoneID)
	if err != nil {
		return nil, "", err
	}
	m := &Milestone{}
	exists, err := getJSON(ctx, k, m)
	if err != nil {
		return nil, "", err
	}
	if !exists {
		return nil, "", fmt.Errorf("milestone %s does not exist for award %s", milestoneID, awardID)
	}
	return m, k, nil
}

func milestonesFor(ctx contractapi.TransactionContextInterface, awardID string) ([]*Milestone, error) {
	it, err := ctx.GetStub().GetStateByPartialCompositeKey(typeMilestone, []string{awardID})
	if err != nil {
		return nil, err
	}
	defer it.Close()
	out := []*Milestone{}
	for it.HasNext() {
		kv, err := it.Next()
		if err != nil {
			return nil, err
		}
		m := &Milestone{}
		if err := json.Unmarshal(kv.Value, m); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, nil
}
