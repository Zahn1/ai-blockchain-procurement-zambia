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
	DocType        string   `json:"docType"`
	ID             string   `json:"id"`
	AwardID        string   `json:"awardId"`
	Amount         int64    `json:"amount"` // ngwee
	DueDate        string   `json:"dueDate"`
	Status         string   `json:"status"`
	EvidenceHash   string   `json:"evidenceHash,omitempty" metadata:",optional"` // hash of the signed completion certificate
	CompletedAt    string   `json:"completedAt,omitempty" metadata:",optional"`
	CompletionDate string   `json:"completionDate,omitempty" metadata:",optional"` // date of completion stated on the certificate
	CertifiedBy    string   `json:"certifiedBy,omitempty" metadata:",optional"`    // callerRef of the inspector
	PaidTotal      int64    `json:"paidTotal"`
	PaymentIDs     []string `json:"paymentIds"`
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

// CompleteMilestone records an authorised inspector's signed completion certificate (Chapter 3, 3.5.6).
// The transaction is signed with the inspector's own key. The contract checks the certificate against the milestone
// terms: the amount certified must equal the milestone amount, and the completion date must fall between the
// contract signature and now.
func (c *MilestoneContract) CompleteMilestone(ctx contractapi.TransactionContextInterface, awardID string,
	milestoneID string, certificateHash string, certifiedAmount int64, completionDate string) error {
	if err := requireAccess(ctx, []string{MSPZPPA}, RoleInspector); err != nil {
		return err
	}
	if err := checkHash("certificate hash", certificateHash); err != nil {
		return err
	}
	a, _, err := loadAward(ctx, awardID)
	if err != nil {
		return err
	}
	if a.Status != ContractSigned {
		return fmt.Errorf("award %s has no signed contract", awardID)
	}
	m, k, err := loadMilestone(ctx, awardID, milestoneID)
	if err != nil {
		return err
	}
	if m.Status != MilestonePending {
		return fmt.Errorf("milestone %s is already %s", milestoneID, m.Status)
	}
	if certifiedAmount != m.Amount {
		return fmt.Errorf("the certificate certifies %d ngwee, but milestone %s is for %d ngwee", certifiedAmount, milestoneID, m.Amount)
	}
	now, err := txTime(ctx)
	if err != nil {
		return err
	}
	done, err := parseTime(completionDate)
	if err != nil {
		return err
	}
	signed, _ := parseTime(a.SignedAt)
	if done.Before(signed) {
		return fmt.Errorf("the completion date %s is before the contract was signed on %s", formatTime(done), a.SignedAt)
	}
	if done.After(now) {
		return fmt.Errorf("the completion date %s is in the future", formatTime(done))
	}
	ref, err := callerRef(ctx)
	if err != nil {
		return err
	}
	m.Status, m.EvidenceHash, m.CompletedAt = MilestoneCompleted, certificateHash, formatTime(now)
	m.CompletionDate, m.CertifiedBy = formatTime(done), ref
	if err := putJSON(ctx, k, m); err != nil {
		return err
	}
	return emit(ctx, "MilestoneCompleted", MilestoneEvent{AwardID: awardID, MilestoneID: milestoneID,
		Status: m.Status, Amount: m.Amount, DocHash: certificateHash, TxTime: m.CompletedAt})
}

// Payability is the ledger's answer to "may this payment be made?".
type Payability struct {
	Payable bool   `json:"payable"`
	Reason  string `json:"reason"`
}

// CheckPayable answers, without changing anything, whether a payment would be accepted. The back end asks this
// before sending a payment instruction to IFMIS, so no instruction is issued that the ledger would then refuse.
func (c *MilestoneContract) CheckPayable(ctx contractapi.TransactionContextInterface,
	awardID string, milestoneID string, amount int64) (*Payability, error) {
	a, _, err := loadAward(ctx, awardID)
	if err != nil {
		return nil, err
	}
	m, _, err := loadMilestone(ctx, awardID, milestoneID)
	if err != nil {
		return nil, err
	}
	reason, err := payBlocker(ctx, a, m, amount)
	if err != nil {
		return nil, err
	}
	return &Payability{Payable: reason == "", Reason: reason}, nil
}

// payBlocker returns why a payment may not be made, or "" if it may: the milestone must be certified complete,
// the amount must fit the milestone and the contract, and neither the contract nor its tender may be flagged
// as high risk (3.5.6).
func payBlocker(ctx contractapi.TransactionContextInterface, a *Award, m *Milestone, amount int64) (string, error) {
	if amount <= 0 {
		return "the payment amount must be positive", nil
	}
	if m.Status != MilestoneCompleted {
		return fmt.Sprintf("milestone %s is %s; payment is allowed only after an inspector certifies completion", m.ID, m.Status), nil
	}
	if m.PaidTotal+amount > m.Amount {
		return fmt.Sprintf("payment would bring milestone %s to %d ngwee, above its amount of %d", m.ID, m.PaidTotal+amount, m.Amount), nil
	}
	if a.PaidTotal+amount > a.ContractValue {
		return fmt.Sprintf("payment would bring the contract to %d ngwee, above its value of %d; record a variation first",
			a.PaidTotal+amount, a.ContractValue), nil
	}
	flag, err := highRiskFlag(ctx, a.ID, a.TenderID)
	if err != nil || flag == "" {
		return "", err
	}
	return flag + "; payment is held until a regulator clears or decides to monitor it", nil
}

// RecordPayment records a payment made through IFMIS, with its IFMIS reference (Chapter 3, 3.5.6).
// It applies the same checks as CheckPayable and refuses a payment ID that was already used.
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
	a, ak, err := loadAward(ctx, awardID)
	if err != nil {
		return err
	}
	m, mk, err := loadMilestone(ctx, awardID, milestoneID)
	if err != nil {
		return err
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
	if reason, err := payBlocker(ctx, a, m, amount); err != nil {
		return err
	} else if reason != "" {
		return fmt.Errorf("%s", reason)
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
