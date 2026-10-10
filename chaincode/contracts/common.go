// Package contracts holds the procurement chaincode: tender, bid, award, milestone and alert contracts.
//
// Ledger rule: only hashes, IDs, amounts (in ngwee), statuses and timestamps go on-chain.
// Determinism rule: time comes from the transaction timestamp, never time.Now(); no map iteration.
package contracts

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

// Organisation MSP IDs.
const (
	MSPZPPA = "ZPPAMSP"
	MSPOAG  = "OAGMSP"
)

// Roles carried in the "role" attribute of a user's certificate (set when the Fabric CA registers the user).
const (
	RoleOfficer   = "officer"   // procurement officer at a procuring entity
	RoleCommittee = "committee" // evaluation committee member
	RoleGateway   = "gateway"   // back-end service submitting on behalf of suppliers
	RoleAI        = "ai"        // AI risk service
	RoleRegulator = "regulator" // ZPPA compliance staff
	RoleAuditor   = "auditor"   // Office of the Auditor General
)

// Ledger object types, used as the first part of composite keys.
const (
	typeTender    = "tender"
	typeBid       = "bid"
	typeAward     = "award"
	typeMilestone = "milestone"
	typePayment   = "payment"
	typeAlert     = "alert"
)

const timeLayout = time.RFC3339

var (
	sha256Hex = regexp.MustCompile(`^[0-9a-f]{64}$`)
	// IDs and pseudonyms: letters, digits, dash, underscore, dot and slash (ZPPA references use slashes).
	safeID = regexp.MustCompile(`^[A-Za-z0-9._/-]{3,64}$`)
)

// txTime returns the transaction timestamp, which is the same on every endorsing peer.
func txTime(ctx contractapi.TransactionContextInterface) (time.Time, error) {
	ts, err := ctx.GetStub().GetTxTimestamp()
	if err != nil {
		return time.Time{}, fmt.Errorf("reading transaction timestamp: %w", err)
	}
	return ts.AsTime().UTC(), nil
}

func formatTime(t time.Time) string { return t.UTC().Format(timeLayout) }

func parseTime(s string) (time.Time, error) {
	t, err := time.Parse(timeLayout, s)
	if err != nil {
		return time.Time{}, fmt.Errorf("time %q must be RFC 3339, e.g. 2026-11-01T10:00:00Z", s)
	}
	return t.UTC(), nil
}

// requireAccess checks that the caller belongs to one of the allowed organisations and holds one of the allowed roles.
// An empty roles list means any role in an allowed organisation.
func requireAccess(ctx contractapi.TransactionContextInterface, msps []string, roles ...string) error {
	id := ctx.GetClientIdentity()
	msp, err := id.GetMSPID()
	if err != nil {
		return fmt.Errorf("reading caller organisation: %w", err)
	}
	if !slices.Contains(msps, msp) {
		return fmt.Errorf("access denied: organisation %s may not perform this action", msp)
	}
	if len(roles) == 0 {
		return nil
	}
	role, found, err := id.GetAttributeValue("role")
	if err != nil {
		return fmt.Errorf("reading caller role: %w", err)
	}
	if !found || !slices.Contains(roles, role) {
		return fmt.Errorf("access denied: role %q may not perform this action", role)
	}
	return nil
}

// callerRef is a pseudonym for the caller: the SHA-256 of their certificate identity.
// It tells approvers apart without putting names on the ledger.
func callerRef(ctx contractapi.TransactionContextInterface) (string, error) {
	id, err := ctx.GetClientIdentity().GetID()
	if err != nil {
		return "", fmt.Errorf("reading caller identity: %w", err)
	}
	sum := sha256.Sum256([]byte(id))
	return hex.EncodeToString(sum[:]), nil
}

func callerMSP(ctx contractapi.TransactionContextInterface) string {
	msp, _ := ctx.GetClientIdentity().GetMSPID()
	return msp
}

func key(ctx contractapi.TransactionContextInterface, objectType string, parts ...string) (string, error) {
	return ctx.GetStub().CreateCompositeKey(objectType, parts)
}

// getJSON loads a ledger value into v. It returns false if the key does not exist.
func getJSON(ctx contractapi.TransactionContextInterface, k string, v any) (bool, error) {
	b, err := ctx.GetStub().GetState(k)
	if err != nil {
		return false, fmt.Errorf("reading world state: %w", err)
	}
	if b == nil {
		return false, nil
	}
	return true, json.Unmarshal(b, v)
}

// putJSON stores v. Struct fields marshal in a fixed order, so every peer writes identical bytes.
func putJSON(ctx contractapi.TransactionContextInterface, k string, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return ctx.GetStub().PutState(k, b)
}

// emit sets the chaincode event for this transaction. Fabric keeps one event per transaction.
func emit(ctx contractapi.TransactionContextInterface, name string, payload any) error {
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return ctx.GetStub().SetEvent(name, b)
}

func checkHash(field, h string) error {
	if !sha256Hex.MatchString(h) {
		return fmt.Errorf("%s must be a lowercase hex SHA-256 hash (64 characters)", field)
	}
	return nil
}

func checkID(field, id string) error {
	if !safeID.MatchString(id) {
		return fmt.Errorf("%s %q must be 3–64 characters: letters, digits, . _ / -", field, id)
	}
	return nil
}

func checkAmount(field string, ngwee int64) error {
	if ngwee <= 0 {
		return fmt.Errorf("%s must be a positive amount in ngwee", field)
	}
	return nil
}
