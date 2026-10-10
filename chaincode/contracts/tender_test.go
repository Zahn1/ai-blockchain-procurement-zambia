package contracts

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

const tenderID = "ZPPA/MOH/2026/0042"

var closing = t0.Add(10 * 24 * time.Hour) // 10 days after "now"

func docs(seeds ...byte) string {
	hs := make([]string, len(seeds))
	for i, s := range seeds {
		hs[i] = hash(s)
	}
	b, _ := json.Marshal(hs)
	return string(b)
}

func publish(t *testing.T, l *ledger) {
	t.Helper()
	require.NoError(t, (&TenderContract{}).PublishTender(l.as(officer), tenderID, 150_000_00, formatTime(closing), docs(1), 2))
}

// FR-TND-01, FR-TND-02, FR-TND-03
func TestPublishTender_RecordsTenderAndEmitsEvent(t *testing.T) {
	l := newLedger(t)
	publish(t, l)

	got, err := (&TenderContract{}).ReadTender(l.as(auditor), tenderID)
	require.NoError(t, err)
	require.Equal(t, TenderPublished, got.Status)
	require.Equal(t, int64(150_000_00), got.EstValue)
	require.Equal(t, "ZMW", got.Currency)
	require.Equal(t, []string{hash(1)}, got.DocHashes)
	require.Equal(t, formatTime(closing), got.ClosingTime)
	require.Equal(t, MSPZPPA, got.PublishedBy)
	require.Equal(t, 1, got.Version)

	ev := l.lastEvent()
	require.Equal(t, "TenderPublished", ev.Name)
	require.JSONEq(t, `{"tenderId":"ZPPA/MOH/2026/0042","status":"PUBLISHED","version":1,
		"closingTime":"2026-11-12T09:00:00Z","txTime":"2026-11-02T09:00:00Z"}`, string(ev.Payload))
}

func TestPublishTender_DefaultQuorumIsTwo(t *testing.T) {
	l := newLedger(t)
	require.NoError(t, (&TenderContract{}).PublishTender(l.as(officer), tenderID, 100, formatTime(closing), docs(1), 0))
	got, _ := (&TenderContract{}).ReadTender(l.as(auditor), tenderID)
	require.Equal(t, 2, got.Quorum)
}

func TestPublishTender_Rejections(t *testing.T) {
	cases := []struct {
		name    string
		who     fakeIdentity
		id      string
		value   int64
		closing time.Time
		docs    string
		quorum  int
		wantErr string
	}{
		{"auditor organisation", auditor, tenderID, 100, closing, docs(1), 2, "organisation OAGMSP"},
		{"supplier gateway role", gateway, tenderID, 100, closing, docs(1), 2, `role "gateway"`},
		{"closing in the past", officer, tenderID, 100, t0.Add(-time.Hour), docs(1), 2, "must be after"},
		{"closing equals now", officer, tenderID, 100, t0, docs(1), 2, "must be after"},
		{"zero value", officer, tenderID, 0, closing, docs(1), 2, "positive amount"},
		{"bad hash", officer, tenderID, 100, closing, `["not-a-hash"]`, 2, "SHA-256"},
		{"no documents", officer, tenderID, 100, closing, `[]`, 2, "at least one document"},
		{"unsafe ID", officer, "a b", 100, closing, docs(1), 2, "tender ID"},
		{"quorum too large", officer, tenderID, 100, closing, docs(1), 16, "quorum"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			l := newLedger(t)
			err := (&TenderContract{}).PublishTender(l.as(tc.who), tc.id, tc.value, formatTime(tc.closing), tc.docs, tc.quorum)
			require.ErrorContains(t, err, tc.wantErr)
			require.Empty(t, l.stub.state, "nothing may be written when a transaction is rejected")
		})
	}
}

func TestPublishTender_DuplicateRejected(t *testing.T) {
	l := newLedger(t)
	publish(t, l)
	err := (&TenderContract{}).PublishTender(l.as(officer), tenderID, 999, formatTime(closing), docs(2), 2)
	require.ErrorContains(t, err, "already exists")
}

// FR-TND-04
func TestAmendTender_ExtendsClosingAndAddsAddendum(t *testing.T) {
	l := newLedger(t)
	publish(t, l)
	later := closing.Add(48 * time.Hour)
	require.NoError(t, (&TenderContract{}).AmendTender(l.at(t0.Add(time.Hour)).as(officer), tenderID, formatTime(later), docs(2)))

	got, _ := (&TenderContract{}).ReadTender(l.as(auditor), tenderID)
	require.Equal(t, formatTime(later), got.ClosingTime)
	require.Equal(t, []string{hash(1), hash(2)}, got.DocHashes, "the original document hash must stay")
	require.Equal(t, 2, got.Version)
	require.Equal(t, "TenderAmended", l.lastEvent().Name)
}

func TestAmendTender_Rejections(t *testing.T) {
	t.Run("bring closing forward", func(t *testing.T) {
		l := newLedger(t)
		publish(t, l)
		err := (&TenderContract{}).AmendTender(l.as(officer), tenderID, formatTime(closing.Add(-time.Hour)), "")
		require.ErrorContains(t, err, "only be extended")
	})
	t.Run("after closing", func(t *testing.T) {
		l := newLedger(t)
		publish(t, l)
		err := (&TenderContract{}).AmendTender(l.at(closing).as(officer), tenderID, "", docs(2))
		require.ErrorContains(t, err, "closed at")
	})
	t.Run("no change", func(t *testing.T) {
		l := newLedger(t)
		publish(t, l)
		require.ErrorContains(t, (&TenderContract{}).AmendTender(l.as(officer), tenderID, "", ""), "must change")
	})
	t.Run("unknown tender", func(t *testing.T) {
		l := newLedger(t)
		require.ErrorContains(t, (&TenderContract{}).AmendTender(l.as(officer), "NOPE-1", "", docs(2)), "does not exist")
	})
}

// FR-TND-05
func TestCancelTender(t *testing.T) {
	l := newLedger(t)
	publish(t, l)
	require.NoError(t, (&TenderContract{}).CancelTender(l.as(officer), tenderID, hash(9)))

	got, _ := (&TenderContract{}).ReadTender(l.as(auditor), tenderID)
	require.Equal(t, TenderCancelled, got.Status)
	require.Equal(t, hash(9), got.ReasonHash)
	require.Equal(t, "TenderCancelled", l.lastEvent().Name)

	require.ErrorContains(t, (&TenderContract{}).CancelTender(l.as(officer), tenderID, hash(9)), "CANCELLED")
	require.ErrorContains(t, (&TenderContract{}).AmendTender(l.as(officer), tenderID, "", docs(2)), "CANCELLED")
}

func TestTenderExists(t *testing.T) {
	l := newLedger(t)
	ok, err := (&TenderContract{}).TenderExists(l.as(auditor), tenderID)
	require.NoError(t, err)
	require.False(t, ok)
	publish(t, l)
	ok, _ = (&TenderContract{}).TenderExists(l.as(auditor), tenderID)
	require.True(t, ok)
}

// NFR-03: the stored record holds only IDs, hashes, amounts, statuses and times.
func TestTenderRecord_HoldsNoFreeText(t *testing.T) {
	l := newLedger(t)
	publish(t, l)
	for _, v := range l.stub.state {
		var m map[string]any
		require.NoError(t, json.Unmarshal(v, &m))
		for k := range m {
			require.NotContains(t, []string{"title", "description", "name", "email", "phone"}, k)
		}
	}
}

// NFR-04: the same transactions at the same times write byte-identical state, as every peer must.
func TestDeterminism_SameInputsSameState(t *testing.T) {
	run := func() map[string][]byte {
		l := newLedger(t)
		publish(t, l)
		_ = (&TenderContract{}).AmendTender(l.at(t0.Add(time.Hour)).as(officer), tenderID, "", docs(2))
		_, _ = (&BidContract{}).SubmitBid(l.as(gateway), tenderID, "BID-001", "SUP-alpha", hash(3))
		return l.stub.state
	}
	require.Equal(t, run(), run())
}
