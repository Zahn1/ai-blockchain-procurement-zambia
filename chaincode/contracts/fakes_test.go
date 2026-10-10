package contracts

import (
	"crypto/x509"
	"fmt"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/hyperledger/fabric-chaincode-go/v2/pkg/cid"
	"github.com/hyperledger/fabric-chaincode-go/v2/shim"
	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
	"github.com/hyperledger/fabric-protos-go-apiv2/ledger/queryresult"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// fakeStub is an in-memory world state. Methods the contracts do not use panic via the nil embedded interface.
type fakeStub struct {
	shim.ChaincodeStubInterface
	state  map[string][]byte
	now    time.Time
	txSeq  int
	events []fakeEvent
}

type fakeEvent struct {
	Name    string
	Payload []byte
}

func newFakeStub(now time.Time) *fakeStub {
	return &fakeStub{state: map[string][]byte{}, now: now}
}

func (s *fakeStub) GetState(k string) ([]byte, error) { return s.state[k], nil }
func (s *fakeStub) PutState(k string, v []byte) error { s.state[k] = v; return nil }
func (s *fakeStub) DelState(k string) error           { delete(s.state, k); return nil }
func (s *fakeStub) GetTxID() string                   { return fmt.Sprintf("tx%04d", s.txSeq) }
func (s *fakeStub) GetTxTimestamp() (*timestamppb.Timestamp, error) {
	return timestamppb.New(s.now), nil
}
func (s *fakeStub) SetEvent(name string, payload []byte) error {
	s.events = append(s.events, fakeEvent{name, payload})
	return nil
}

// CreateCompositeKey follows Fabric's format: U+0000, type, U+0000, then each attribute followed by U+0000.
func (s *fakeStub) CreateCompositeKey(objectType string, attrs []string) (string, error) {
	return "\x00" + objectType + "\x00" + strings.Join(attrs, "\x00") + "\x00", nil
}

func (s *fakeStub) GetStateByPartialCompositeKey(objectType string, attrs []string) (shim.StateQueryIteratorInterface, error) {
	prefix, _ := s.CreateCompositeKey(objectType, attrs)
	if len(attrs) == 0 {
		prefix = "\x00" + objectType + "\x00"
	}
	var keys []string
	for k := range s.state {
		if strings.HasPrefix(k, prefix) {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys) // the real ledger returns keys in order
	kvs := make([]*queryresult.KV, len(keys))
	for i, k := range keys {
		kvs[i] = &queryresult.KV{Key: k, Value: s.state[k]}
	}
	return &fakeIterator{kvs: kvs}, nil
}

type fakeIterator struct {
	kvs []*queryresult.KV
	i   int
}

func (it *fakeIterator) HasNext() bool { return it.i < len(it.kvs) }
func (it *fakeIterator) Close() error  { return nil }
func (it *fakeIterator) Next() (*queryresult.KV, error) {
	kv := it.kvs[it.i]
	it.i++
	return kv, nil
}

// fakeIdentity stands in for the caller's X.509 certificate.
type fakeIdentity struct {
	id, msp, role string
}

var _ cid.ClientIdentity = fakeIdentity{}

func (f fakeIdentity) GetID() (string, error)    { return f.id, nil }
func (f fakeIdentity) GetMSPID() (string, error) { return f.msp, nil }
func (f fakeIdentity) GetAttributeValue(attr string) (string, bool, error) {
	if attr == "role" && f.role != "" {
		return f.role, true, nil
	}
	return "", false, nil
}
func (f fakeIdentity) AssertAttributeValue(attr, value string) error {
	if v, ok, _ := f.GetAttributeValue(attr); !ok || v != value {
		return fmt.Errorf("attribute %s is not %s", attr, value)
	}
	return nil
}
func (f fakeIdentity) GetX509Certificate() (*x509.Certificate, error) { return nil, nil }

// Callers used in the tests.
var (
	officer    = fakeIdentity{"x509::CN=officer1::CN=ca.zppa", MSPZPPA, RoleOfficer}
	gateway    = fakeIdentity{"x509::CN=gateway::CN=ca.zppa", MSPZPPA, RoleGateway}
	committee1 = fakeIdentity{"x509::CN=member1::CN=ca.zppa", MSPZPPA, RoleCommittee}
	committee2 = fakeIdentity{"x509::CN=member2::CN=ca.zppa", MSPZPPA, RoleCommittee}
	auditor    = fakeIdentity{"x509::CN=auditor1::CN=ca.oag", MSPOAG, RoleAuditor}
	regulator  = fakeIdentity{"x509::CN=regulator1::CN=ca.zppa", MSPZPPA, RoleRegulator}
	aiService  = fakeIdentity{"x509::CN=risk-service::CN=ca.zppa", MSPZPPA, RoleAI}
)

// ledger bundles a fake stub with a helper to act as a given caller at a given time.
type ledger struct {
	t    *testing.T
	stub *fakeStub
}

var t0 = time.Date(2026, 11, 2, 9, 0, 0, 0, time.UTC) // test "now"

func newLedger(t *testing.T) *ledger {
	return &ledger{t: t, stub: newFakeStub(t0)}
}

// as returns a transaction context for the caller, advancing the transaction counter.
func (l *ledger) as(who fakeIdentity) contractapi.TransactionContextInterface {
	l.stub.txSeq++
	ctx := new(contractapi.TransactionContext)
	ctx.SetStub(l.stub)
	ctx.SetClientIdentity(who)
	return ctx
}

func (l *ledger) at(t time.Time) *ledger { l.stub.now = t; return l }

func (l *ledger) lastEvent() fakeEvent {
	if len(l.stub.events) == 0 {
		l.t.Fatal("no event emitted")
	}
	return l.stub.events[len(l.stub.events)-1]
}

// hash returns a valid-looking SHA-256 hex string that differs per seed.
func hash(seed byte) string {
	return strings.Repeat(fmt.Sprintf("%02x", seed), 32)
}
