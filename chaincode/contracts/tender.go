package contracts

import (
	"encoding/json"
	"fmt"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

// Tender statuses.
const (
	TenderPublished = "PUBLISHED"
	TenderCancelled = "CANCELLED"
	TenderAwarded   = "AWARDED"
)

const defaultQuorum = 2

// Tender is the on-chain record of a tender. Titles and documents stay off-chain (IPFS); only their hashes are here.
type Tender struct {
	DocType         string   `json:"docType"`
	ID              string   `json:"id"`
	EstValue        int64    `json:"estValue"` // ngwee
	Currency        string   `json:"currency"`
	ClosingTime     string   `json:"closingTime"`
	DocHashes       []string `json:"docHashes"`
	Quorum          int      `json:"quorum"`    // committee approvals needed to open bids
	Approvals       []string `json:"approvals"` // callerRef of each approving committee member
	OpeningApproved bool     `json:"openingApproved"`
	Status          string   `json:"status"`
	ReasonHash      string   `json:"reasonHash,omitempty" metadata:",optional"`
	Version         int      `json:"version"`
	PublishedBy     string   `json:"publishedBy"` // MSP ID
	UpdatedAt       string   `json:"updatedAt"`
}

// TenderEvent is the payload of tender events.
type TenderEvent struct {
	TenderID    string `json:"tenderId"`
	Status      string `json:"status"`
	Version     int    `json:"version"`
	ClosingTime string `json:"closingTime"`
	TxTime      string `json:"txTime"`
}

// HistoryEntry is one past version of a tender.
type HistoryEntry struct {
	TxID      string  `json:"txId"`
	Timestamp string  `json:"timestamp"`
	IsDelete  bool    `json:"isDelete"`
	Tender    *Tender `json:"tender,omitempty" metadata:",optional"`
}

// TenderContract records the publication, amendment and cancellation of tenders.
type TenderContract struct {
	contractapi.Contract
}

// PublishTender records a new tender. docHashesJSON is a JSON array of SHA-256 hashes of the tender documents.
// quorum is the number of committee approvals needed to open bids (0 means the default of 2).
func (c *TenderContract) PublishTender(ctx contractapi.TransactionContextInterface,
	id string, estValue int64, closingTime string, docHashesJSON string, quorum int) error {
	if err := requireAccess(ctx, []string{MSPZPPA}, RoleOfficer); err != nil {
		return err
	}
	if err := checkID("tender ID", id); err != nil {
		return err
	}
	if err := checkAmount("estimated value", estValue); err != nil {
		return err
	}
	hashes, err := parseHashes(docHashesJSON)
	if err != nil {
		return err
	}
	if len(hashes) == 0 {
		return fmt.Errorf("a tender needs at least one document hash")
	}
	if quorum == 0 {
		quorum = defaultQuorum
	}
	if quorum < 1 || quorum > 15 {
		return fmt.Errorf("quorum must be between 1 and 15")
	}
	now, err := txTime(ctx)
	if err != nil {
		return err
	}
	closing, err := parseTime(closingTime)
	if err != nil {
		return err
	}
	if !closing.After(now) {
		return fmt.Errorf("closing time %s must be after the transaction time %s", formatTime(closing), formatTime(now))
	}
	k, err := key(ctx, typeTender, id)
	if err != nil {
		return err
	}
	if exists, err := getJSON(ctx, k, &Tender{}); err != nil {
		return err
	} else if exists {
		return fmt.Errorf("tender %s already exists", id)
	}

	t := &Tender{
		DocType: typeTender, ID: id, EstValue: estValue, Currency: "ZMW",
		ClosingTime: formatTime(closing), DocHashes: hashes, Quorum: quorum, Approvals: []string{},
		Status: TenderPublished, Version: 1, PublishedBy: callerMSP(ctx), UpdatedAt: formatTime(now),
	}
	if err := putJSON(ctx, k, t); err != nil {
		return err
	}
	return emit(ctx, "TenderPublished", tenderEvent(t))
}

// AmendTender adds documents (an addendum) and may extend the closing time. It may not shorten it.
// Pass an empty newClosingTime to keep the current one. Earlier versions stay in the key history.
func (c *TenderContract) AmendTender(ctx contractapi.TransactionContextInterface,
	id string, newClosingTime string, addDocHashesJSON string) error {
	if err := requireAccess(ctx, []string{MSPZPPA}, RoleOfficer); err != nil {
		return err
	}
	t, k, err := loadTender(ctx, id)
	if err != nil {
		return err
	}
	now, err := txTime(ctx)
	if err != nil {
		return err
	}
	if t.Status != TenderPublished {
		return fmt.Errorf("tender %s is %s and cannot be amended", id, t.Status)
	}
	closing, _ := parseTime(t.ClosingTime)
	if !now.Before(closing) {
		return fmt.Errorf("tender %s closed at %s and cannot be amended", id, t.ClosingTime)
	}
	if newClosingTime != "" {
		nc, err := parseTime(newClosingTime)
		if err != nil {
			return err
		}
		if nc.Before(closing) {
			return fmt.Errorf("the closing time can only be extended, not brought forward")
		}
		t.ClosingTime = formatTime(nc)
	}
	added, err := parseHashes(addDocHashesJSON)
	if err != nil {
		return err
	}
	if newClosingTime == "" && len(added) == 0 {
		return fmt.Errorf("an amendment must change the closing time or add documents")
	}
	t.DocHashes = append(t.DocHashes, added...)
	t.Version++
	t.UpdatedAt = formatTime(now)
	if err := putJSON(ctx, k, t); err != nil {
		return err
	}
	return emit(ctx, "TenderAmended", tenderEvent(t))
}

// CancelTender cancels a tender that has not been awarded. reasonHash is the hash of the cancellation notice.
func (c *TenderContract) CancelTender(ctx contractapi.TransactionContextInterface, id string, reasonHash string) error {
	if err := requireAccess(ctx, []string{MSPZPPA}, RoleOfficer); err != nil {
		return err
	}
	if err := checkHash("reason hash", reasonHash); err != nil {
		return err
	}
	t, k, err := loadTender(ctx, id)
	if err != nil {
		return err
	}
	if t.Status != TenderPublished {
		return fmt.Errorf("tender %s is %s and cannot be cancelled", id, t.Status)
	}
	now, err := txTime(ctx)
	if err != nil {
		return err
	}
	t.Status, t.ReasonHash, t.UpdatedAt = TenderCancelled, reasonHash, formatTime(now)
	t.Version++
	if err := putJSON(ctx, k, t); err != nil {
		return err
	}
	return emit(ctx, "TenderCancelled", tenderEvent(t))
}

// ReadTender returns a tender. Anyone on the channel may read.
func (c *TenderContract) ReadTender(ctx contractapi.TransactionContextInterface, id string) (*Tender, error) {
	t, _, err := loadTender(ctx, id)
	return t, err
}

// TenderExists reports whether a tender ID is on the ledger.
func (c *TenderContract) TenderExists(ctx contractapi.TransactionContextInterface, id string) (bool, error) {
	k, err := key(ctx, typeTender, id)
	if err != nil {
		return false, err
	}
	return getJSON(ctx, k, &Tender{})
}

// GetTenderHistory returns every version of a tender, oldest first, for auditors.
func (c *TenderContract) GetTenderHistory(ctx contractapi.TransactionContextInterface, id string) ([]*HistoryEntry, error) {
	k, err := key(ctx, typeTender, id)
	if err != nil {
		return nil, err
	}
	it, err := ctx.GetStub().GetHistoryForKey(k)
	if err != nil {
		return nil, err
	}
	defer it.Close()
	var out []*HistoryEntry
	for it.HasNext() {
		m, err := it.Next()
		if err != nil {
			return nil, err
		}
		e := &HistoryEntry{TxID: m.TxId, Timestamp: formatTime(m.Timestamp.AsTime()), IsDelete: m.IsDelete}
		if !m.IsDelete {
			e.Tender = &Tender{}
			if err := json.Unmarshal(m.Value, e.Tender); err != nil {
				return nil, err
			}
		}
		out = append(out, e)
	}
	// Fabric returns newest first; reverse so auditors read the story in order
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out, nil
}

func loadTender(ctx contractapi.TransactionContextInterface, id string) (*Tender, string, error) {
	k, err := key(ctx, typeTender, id)
	if err != nil {
		return nil, "", err
	}
	t := &Tender{}
	exists, err := getJSON(ctx, k, t)
	if err != nil {
		return nil, "", err
	}
	if !exists {
		return nil, "", fmt.Errorf("tender %s does not exist", id)
	}
	return t, k, nil
}

func parseHashes(s string) ([]string, error) {
	if s == "" {
		return []string{}, nil
	}
	var hashes []string
	if err := json.Unmarshal([]byte(s), &hashes); err != nil {
		return nil, fmt.Errorf("document hashes must be a JSON array of strings")
	}
	for _, h := range hashes {
		if err := checkHash("document hash", h); err != nil {
			return nil, err
		}
	}
	return hashes, nil
}

func tenderEvent(t *Tender) TenderEvent {
	return TenderEvent{TenderID: t.ID, Status: t.Status, Version: t.Version, ClosingTime: t.ClosingTime, TxTime: t.UpdatedAt}
}
