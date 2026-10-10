package contracts

import (
	"encoding/json"
	"fmt"
	"slices"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

// Bid is the on-chain record of a sealed bid. The encrypted file is on IPFS; only its hash is here.
type Bid struct {
	DocType     string `json:"docType"`
	ID          string `json:"id"`
	TenderID    string `json:"tenderId"`
	SupplierRef string `json:"supplierRef"` // pseudonym; the mapping to the company stays off-chain
	CipherHash  string `json:"cipherHash"`  // SHA-256 of the AES-256-GCM ciphertext
	SubmittedAt string `json:"submittedAt"`
	TxID        string `json:"txId"`
	Opened      bool   `json:"opened"`
	PlainHash   string `json:"plainHash,omitempty" metadata:",optional"` // SHA-256 of the decrypted file
	OpenedAt    string `json:"openedAt,omitempty" metadata:",optional"`
}

// BidReceipt is returned to the supplier as proof of on-time submission.
type BidReceipt struct {
	BidID       string `json:"bidId"`
	TenderID    string `json:"tenderId"`
	CipherHash  string `json:"cipherHash"`
	SubmittedAt string `json:"submittedAt"`
	TxID        string `json:"txId"`
}

// ApprovalEvent is emitted for each committee approval.
type ApprovalEvent struct {
	TenderID        string `json:"tenderId"`
	ApproverRef     string `json:"approverRef"`
	Approvals       int    `json:"approvals"`
	Quorum          int    `json:"quorum"`
	OpeningApproved bool   `json:"openingApproved"`
	TxTime          string `json:"txTime"`
}

// BidContract handles sealed bids: submission before closing, committee approval, and opening.
type BidContract struct {
	contractapi.Contract
}

// SubmitBid records a sealed bid. It is rejected at or after the closing time, using the transaction timestamp.
func (c *BidContract) SubmitBid(ctx contractapi.TransactionContextInterface,
	tenderID string, bidID string, supplierRef string, cipherHash string) (*BidReceipt, error) {
	if err := requireAccess(ctx, []string{MSPZPPA}, RoleGateway); err != nil {
		return nil, err
	}
	if err := checkID("bid ID", bidID); err != nil {
		return nil, err
	}
	if err := checkID("supplier reference", supplierRef); err != nil {
		return nil, err
	}
	if err := checkHash("cipher hash", cipherHash); err != nil {
		return nil, err
	}
	t, _, err := loadTender(ctx, tenderID)
	if err != nil {
		return nil, err
	}
	if t.Status != TenderPublished {
		return nil, fmt.Errorf("tender %s is %s and is not accepting bids", tenderID, t.Status)
	}
	now, err := txTime(ctx)
	if err != nil {
		return nil, err
	}
	closing, _ := parseTime(t.ClosingTime)
	if !now.Before(closing) {
		return nil, fmt.Errorf("bidding for tender %s closed at %s", tenderID, t.ClosingTime)
	}

	bids, err := bidsForTender(ctx, tenderID)
	if err != nil {
		return nil, err
	}
	for _, b := range bids {
		if b.ID == bidID {
			return nil, fmt.Errorf("bid %s already exists", bidID)
		}
		if b.SupplierRef == supplierRef {
			return nil, fmt.Errorf("supplier %s has already bid on tender %s", supplierRef, tenderID)
		}
	}

	k, err := key(ctx, typeBid, tenderID, bidID)
	if err != nil {
		return nil, err
	}
	b := &Bid{
		DocType: typeBid, ID: bidID, TenderID: tenderID, SupplierRef: supplierRef, CipherHash: cipherHash,
		SubmittedAt: formatTime(now), TxID: ctx.GetStub().GetTxID(),
	}
	if err := putJSON(ctx, k, b); err != nil {
		return nil, err
	}
	r := &BidReceipt{BidID: bidID, TenderID: tenderID, CipherHash: cipherHash, SubmittedAt: b.SubmittedAt, TxID: b.TxID}
	return r, emit(ctx, "BidSubmitted", r)
}

// ApproveOpening records one committee member's approval to open the bids. It is allowed only after closing.
// Each member (identified by certificate) can approve once; opening is unlocked when the quorum is reached.
func (c *BidContract) ApproveOpening(ctx contractapi.TransactionContextInterface, tenderID string) error {
	if err := requireAccess(ctx, []string{MSPZPPA}, RoleCommittee); err != nil {
		return err
	}
	t, k, err := loadTender(ctx, tenderID)
	if err != nil {
		return err
	}
	if t.Status != TenderPublished {
		return fmt.Errorf("tender %s is %s", tenderID, t.Status)
	}
	now, err := txTime(ctx)
	if err != nil {
		return err
	}
	closing, _ := parseTime(t.ClosingTime)
	if now.Before(closing) {
		return fmt.Errorf("bids for tender %s cannot be approved for opening before closing at %s", tenderID, t.ClosingTime)
	}
	ref, err := callerRef(ctx)
	if err != nil {
		return err
	}
	if slices.Contains(t.Approvals, ref) {
		return fmt.Errorf("this committee member has already approved opening for tender %s", tenderID)
	}
	t.Approvals = append(t.Approvals, ref)
	t.OpeningApproved = len(t.Approvals) >= t.Quorum
	t.UpdatedAt = formatTime(now)
	if err := putJSON(ctx, k, t); err != nil {
		return err
	}
	return emit(ctx, "OpeningApproved", ApprovalEvent{
		TenderID: tenderID, ApproverRef: ref, Approvals: len(t.Approvals), Quorum: t.Quorum,
		OpeningApproved: t.OpeningApproved, TxTime: t.UpdatedAt,
	})
}

// OpenBid records that a bid was decrypted. plainHash is the SHA-256 of the decrypted file, so anyone holding
// the file can later prove it is the one opened. Allowed only after closing and once the quorum has approved.
func (c *BidContract) OpenBid(ctx contractapi.TransactionContextInterface,
	tenderID string, bidID string, plainHash string) error {
	if err := requireAccess(ctx, []string{MSPZPPA}, RoleOfficer, RoleCommittee); err != nil {
		return err
	}
	if err := checkHash("plain hash", plainHash); err != nil {
		return err
	}
	t, _, err := loadTender(ctx, tenderID)
	if err != nil {
		return err
	}
	now, err := txTime(ctx)
	if err != nil {
		return err
	}
	closing, _ := parseTime(t.ClosingTime)
	if now.Before(closing) {
		return fmt.Errorf("tender %s has not closed yet", tenderID)
	}
	if !t.OpeningApproved {
		return fmt.Errorf("opening for tender %s needs %d committee approvals; it has %d", tenderID, t.Quorum, len(t.Approvals))
	}
	k, err := key(ctx, typeBid, tenderID, bidID)
	if err != nil {
		return err
	}
	b := &Bid{}
	exists, err := getJSON(ctx, k, b)
	if err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("bid %s does not exist for tender %s", bidID, tenderID)
	}
	if b.Opened {
		return fmt.Errorf("bid %s has already been opened", bidID)
	}
	b.Opened, b.PlainHash, b.OpenedAt = true, plainHash, formatTime(now)
	if err := putJSON(ctx, k, b); err != nil {
		return err
	}
	return emit(ctx, "BidOpened", b)
}

// GetBidsForTender lists the bids for a tender in key order (the same on every peer).
func (c *BidContract) GetBidsForTender(ctx contractapi.TransactionContextInterface, tenderID string) ([]*Bid, error) {
	return bidsForTender(ctx, tenderID)
}

// ReadBid returns one bid.
func (c *BidContract) ReadBid(ctx contractapi.TransactionContextInterface, tenderID string, bidID string) (*Bid, error) {
	k, err := key(ctx, typeBid, tenderID, bidID)
	if err != nil {
		return nil, err
	}
	b := &Bid{}
	exists, err := getJSON(ctx, k, b)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, fmt.Errorf("bid %s does not exist for tender %s", bidID, tenderID)
	}
	return b, nil
}

func bidsForTender(ctx contractapi.TransactionContextInterface, tenderID string) ([]*Bid, error) {
	it, err := ctx.GetStub().GetStateByPartialCompositeKey(typeBid, []string{tenderID})
	if err != nil {
		return nil, err
	}
	defer it.Close()
	bids := []*Bid{}
	for it.HasNext() {
		kv, err := it.Next()
		if err != nil {
			return nil, err
		}
		b := &Bid{}
		if err := json.Unmarshal(kv.Value, b); err != nil {
			return nil, err
		}
		bids = append(bids, b)
	}
	return bids, nil
}
