package contracts

import (
	"fmt"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

// StandstillPeriod is the default time between award and contract signature in which losing bidders may challenge.
// Assumption for the prototype; set it to the period in the Public Procurement Act.
// A ZPPA regulator can change it on-chain with SetStandstillHours; every change is a recorded transaction.
const StandstillPeriod = 10 * 24 * time.Hour

const maxStandstillHours = 720 // 30 days

// StandstillSetting is the on-chain standstill period, if a regulator has set one.
type StandstillSetting struct {
	Hours  int    `json:"hours"`
	SetBy  string `json:"setBy"` // callerRef of the regulator
	SetAt  string `json:"setAt"`
	Reason string `json:"reasonHash"`
}

func standstillKey(ctx contractapi.TransactionContextInterface) (string, error) {
	return key(ctx, "config", "standstill")
}

// standstillPeriod returns the period in force: the on-chain setting, or the default.
func standstillPeriod(ctx contractapi.TransactionContextInterface) (time.Duration, error) {
	k, err := standstillKey(ctx)
	if err != nil {
		return 0, err
	}
	s := &StandstillSetting{}
	exists, err := getJSON(ctx, k, s)
	if err != nil || !exists {
		return StandstillPeriod, err
	}
	return time.Duration(s.Hours) * time.Hour, nil
}

// Award statuses.
const (
	AwardMade      = "AWARDED"
	ContractSigned = "SIGNED"
)

// Award is the on-chain record of an award and, once signed, its contract.
type Award struct {
	DocType        string `json:"docType"`
	ID             string `json:"id"`
	TenderID       string `json:"tenderId"`
	BidID          string `json:"bidId"`
	SupplierRef    string `json:"supplierRef"`
	Amount         int64  `json:"amount"`        // awarded amount, ngwee
	ContractValue  int64  `json:"contractValue"` // amount plus variations, ngwee
	PaidTotal      int64  `json:"paidTotal"`     // sum of recorded payments, ngwee
	EvalHash       string `json:"evalHash"`      // hash of the evaluation report
	ContractHash   string `json:"contractHash,omitempty" metadata:",optional"`
	Variations     int    `json:"variations"`
	Status         string `json:"status"`
	AwardedAt      string `json:"awardedAt"`
	StandstillEnds string `json:"standstillEnds"`
	SignedAt       string `json:"signedAt,omitempty" metadata:",optional"`
	UpdatedAt      string `json:"updatedAt"`
}

// AwardEvent is the payload of award events.
type AwardEvent struct {
	AwardID       string `json:"awardId"`
	TenderID      string `json:"tenderId"`
	Status        string `json:"status"`
	ContractValue int64  `json:"contractValue"`
	DocHash       string `json:"docHash"`
	TxTime        string `json:"txTime"`
}

// AwardContract records awards, contract signature and contract variations.
type AwardContract struct {
	contractapi.Contract
}

// MakeAward awards a tender to an opened bid. evalHash is the hash of the evaluation report (FR-AWD-01).
func (c *AwardContract) MakeAward(ctx contractapi.TransactionContextInterface,
	awardID string, tenderID string, bidID string, amount int64, evalHash string) error {
	if err := requireAccess(ctx, []string{MSPZPPA}, RoleOfficer); err != nil {
		return err
	}
	if err := checkID("award ID", awardID); err != nil {
		return err
	}
	if err := checkAmount("award amount", amount); err != nil {
		return err
	}
	if err := checkHash("evaluation hash", evalHash); err != nil {
		return err
	}
	t, tk, err := loadTender(ctx, tenderID)
	if err != nil {
		return err
	}
	if t.Status != TenderPublished {
		return fmt.Errorf("tender %s is %s and cannot be awarded", tenderID, t.Status)
	}
	bk, err := key(ctx, typeBid, tenderID, bidID)
	if err != nil {
		return err
	}
	b := &Bid{}
	if exists, err := getJSON(ctx, bk, b); err != nil {
		return err
	} else if !exists {
		return fmt.Errorf("bid %s does not exist for tender %s", bidID, tenderID)
	}
	if !b.Opened {
		return fmt.Errorf("bid %s has not been opened and cannot win an award", bidID)
	}
	ak, err := key(ctx, typeAward, awardID)
	if err != nil {
		return err
	}
	if exists, err := getJSON(ctx, ak, &Award{}); err != nil {
		return err
	} else if exists {
		return fmt.Errorf("award %s already exists", awardID)
	}
	now, err := txTime(ctx)
	if err != nil {
		return err
	}
	standstill, err := standstillPeriod(ctx)
	if err != nil {
		return err
	}

	a := &Award{
		DocType: typeAward, ID: awardID, TenderID: tenderID, BidID: bidID, SupplierRef: b.SupplierRef,
		Amount: amount, ContractValue: amount, EvalHash: evalHash, Status: AwardMade,
		AwardedAt: formatTime(now), StandstillEnds: formatTime(now.Add(standstill)), UpdatedAt: formatTime(now),
	}
	t.Status, t.UpdatedAt = TenderAwarded, formatTime(now)
	t.Version++
	if err := putJSON(ctx, tk, t); err != nil {
		return err
	}
	if err := putJSON(ctx, ak, a); err != nil {
		return err
	}
	return emit(ctx, "AwardMade", awardEvent(a, evalHash))
}

// SignContract records the signed contract's hash. Allowed only after the standstill period.
func (c *AwardContract) SignContract(ctx contractapi.TransactionContextInterface, awardID string, contractHash string) error {
	if err := requireAccess(ctx, []string{MSPZPPA}, RoleOfficer); err != nil {
		return err
	}
	if err := checkHash("contract hash", contractHash); err != nil {
		return err
	}
	a, k, err := loadAward(ctx, awardID)
	if err != nil {
		return err
	}
	if a.Status != AwardMade {
		return fmt.Errorf("award %s is already %s", awardID, a.Status)
	}
	now, err := txTime(ctx)
	if err != nil {
		return err
	}
	ends, _ := parseTime(a.StandstillEnds)
	if now.Before(ends) {
		return fmt.Errorf("the standstill period for award %s runs until %s", awardID, a.StandstillEnds)
	}
	a.Status, a.ContractHash, a.SignedAt, a.UpdatedAt = ContractSigned, contractHash, formatTime(now), formatTime(now)
	if err := putJSON(ctx, k, a); err != nil {
		return err
	}
	return emit(ctx, "ContractSigned", awardEvent(a, contractHash))
}

// RecordVariation raises the contract value, backed by the hash of the approved variation document.
func (c *AwardContract) RecordVariation(ctx contractapi.TransactionContextInterface,
	awardID string, newValue int64, variationHash string) error {
	if err := requireAccess(ctx, []string{MSPZPPA}, RoleOfficer); err != nil {
		return err
	}
	if err := checkHash("variation hash", variationHash); err != nil {
		return err
	}
	a, k, err := loadAward(ctx, awardID)
	if err != nil {
		return err
	}
	if a.Status != ContractSigned {
		return fmt.Errorf("award %s has no signed contract to vary", awardID)
	}
	if newValue <= a.ContractValue {
		return fmt.Errorf("a variation must raise the contract value above %d ngwee", a.ContractValue)
	}
	now, err := txTime(ctx)
	if err != nil {
		return err
	}
	a.ContractValue, a.UpdatedAt = newValue, formatTime(now)
	a.Variations++
	if err := putJSON(ctx, k, a); err != nil {
		return err
	}
	return emit(ctx, "ContractVaried", awardEvent(a, variationHash))
}

// SetStandstillHours sets the standstill period for future awards (0–720 hours). Only a ZPPA regulator may do this,
// and reasonHash must point to the decision document. Awards already made keep their original end time.
func (c *AwardContract) SetStandstillHours(ctx contractapi.TransactionContextInterface, hours int, reasonHash string) error {
	if err := requireAccess(ctx, []string{MSPZPPA}, RoleRegulator); err != nil {
		return err
	}
	if hours < 0 || hours > maxStandstillHours {
		return fmt.Errorf("standstill must be between 0 and %d hours", maxStandstillHours)
	}
	if err := checkHash("reason hash", reasonHash); err != nil {
		return err
	}
	now, err := txTime(ctx)
	if err != nil {
		return err
	}
	ref, err := callerRef(ctx)
	if err != nil {
		return err
	}
	k, err := standstillKey(ctx)
	if err != nil {
		return err
	}
	s := &StandstillSetting{Hours: hours, SetBy: ref, SetAt: formatTime(now), Reason: reasonHash}
	if err := putJSON(ctx, k, s); err != nil {
		return err
	}
	return emit(ctx, "StandstillChanged", s)
}

// GetStandstillHours returns the standstill period in force, in hours.
func (c *AwardContract) GetStandstillHours(ctx contractapi.TransactionContextInterface) (int, error) {
	d, err := standstillPeriod(ctx)
	return int(d / time.Hour), err
}

// ReadAward returns an award.
func (c *AwardContract) ReadAward(ctx contractapi.TransactionContextInterface, awardID string) (*Award, error) {
	a, _, err := loadAward(ctx, awardID)
	return a, err
}

func loadAward(ctx contractapi.TransactionContextInterface, awardID string) (*Award, string, error) {
	k, err := key(ctx, typeAward, awardID)
	if err != nil {
		return nil, "", err
	}
	a := &Award{}
	exists, err := getJSON(ctx, k, a)
	if err != nil {
		return nil, "", err
	}
	if !exists {
		return nil, "", fmt.Errorf("award %s does not exist", awardID)
	}
	return a, k, nil
}

func awardEvent(a *Award, docHash string) AwardEvent {
	return AwardEvent{AwardID: a.ID, TenderID: a.TenderID, Status: a.Status, ContractValue: a.ContractValue,
		DocHash: docHash, TxTime: a.UpdatedAt}
}
