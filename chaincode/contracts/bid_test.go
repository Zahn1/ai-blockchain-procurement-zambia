package contracts

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func submit(l *ledger, bidID, supplier string, seed byte) (*BidReceipt, error) {
	return (&BidContract{}).SubmitBid(l.as(gateway), tenderID, bidID, supplier, hash(seed))
}

// openTender publishes a tender, takes two bids, moves past closing and gets quorum approval.
func openTender(t *testing.T) *ledger {
	t.Helper()
	l := newLedger(t)
	publish(t, l)
	_, err := submit(l, "BID-001", "SUP-alpha", 3)
	require.NoError(t, err)
	_, err = submit(l, "BID-002", "SUP-bravo", 4)
	require.NoError(t, err)
	l.at(closing.Add(time.Minute))
	require.NoError(t, (&BidContract{}).ApproveOpening(l.as(committee1), tenderID))
	require.NoError(t, (&BidContract{}).ApproveOpening(l.as(committee2), tenderID))
	return l
}

// FR-BID-01, FR-BID-03, FR-BID-04
func TestSubmitBid_BeforeClosingGivesReceipt(t *testing.T) {
	l := newLedger(t)
	publish(t, l)
	r, err := submit(l.at(closing.Add(-time.Second)), "BID-001", "SUP-alpha", 3)
	require.NoError(t, err)
	require.Equal(t, "BID-001", r.BidID)
	require.Equal(t, hash(3), r.CipherHash)
	require.Equal(t, "2026-11-12T08:59:59Z", r.SubmittedAt)
	require.NotEmpty(t, r.TxID)
	require.Equal(t, "BidSubmitted", l.lastEvent().Name)

	b, err := (&BidContract{}).ReadBid(l.as(auditor), tenderID, "BID-001")
	require.NoError(t, err)
	require.False(t, b.Opened)
	require.Empty(t, b.PlainHash)
}

// FR-BID-01: the deadline is enforced by the transaction timestamp, to the second.
func TestSubmitBid_AtOrAfterClosingRejected(t *testing.T) {
	for _, at := range []time.Time{closing, closing.Add(time.Second), closing.Add(24 * time.Hour)} {
		l := newLedger(t)
		publish(t, l)
		_, err := submit(l.at(at), "BID-LATE", "SUP-late", 5)
		require.ErrorContains(t, err, "closed at", "submitted at %s", at)
	}
}

func TestSubmitBid_Rejections(t *testing.T) {
	t.Run("same supplier twice", func(t *testing.T) {
		l := newLedger(t)
		publish(t, l)
		_, _ = submit(l, "BID-001", "SUP-alpha", 3)
		_, err := submit(l, "BID-002", "SUP-alpha", 4)
		require.ErrorContains(t, err, "already bid")
	})
	t.Run("duplicate bid ID", func(t *testing.T) {
		l := newLedger(t)
		publish(t, l)
		_, _ = submit(l, "BID-001", "SUP-alpha", 3)
		_, err := submit(l, "BID-001", "SUP-bravo", 4)
		require.ErrorContains(t, err, "already exists")
	})
	t.Run("cancelled tender", func(t *testing.T) {
		l := newLedger(t)
		publish(t, l)
		require.NoError(t, (&TenderContract{}).CancelTender(l.as(officer), tenderID, hash(9)))
		_, err := submit(l, "BID-001", "SUP-alpha", 3)
		require.ErrorContains(t, err, "not accepting bids")
	})
	t.Run("officer cannot submit for a supplier", func(t *testing.T) {
		l := newLedger(t)
		publish(t, l)
		_, err := (&BidContract{}).SubmitBid(l.as(officer), tenderID, "BID-001", "SUP-alpha", hash(3))
		require.ErrorContains(t, err, `role "officer"`)
	})
	t.Run("bad cipher hash", func(t *testing.T) {
		l := newLedger(t)
		publish(t, l)
		_, err := (&BidContract{}).SubmitBid(l.as(gateway), tenderID, "BID-001", "SUP-alpha", "abc")
		require.ErrorContains(t, err, "cipher hash")
	})
	t.Run("unknown tender", func(t *testing.T) {
		l := newLedger(t)
		_, err := submit(l, "BID-001", "SUP-alpha", 3)
		require.ErrorContains(t, err, "does not exist")
	})
}

// FR-BID-05: approval is only possible after closing.
func TestApproveOpening_BeforeClosingRejected(t *testing.T) {
	l := newLedger(t)
	publish(t, l)
	err := (&BidContract{}).ApproveOpening(l.at(closing.Add(-time.Second)).as(committee1), tenderID)
	require.ErrorContains(t, err, "before closing")
}

// FR-BID-05: one approval per committee member, and the quorum unlocks opening.
func TestApproveOpening_QuorumOfDistinctMembers(t *testing.T) {
	l := newLedger(t)
	publish(t, l)
	l.at(closing)
	require.NoError(t, (&BidContract{}).ApproveOpening(l.as(committee1), tenderID))
	got, _ := (&TenderContract{}).ReadTender(l.as(auditor), tenderID)
	require.False(t, got.OpeningApproved, "one approval is below the quorum of 2")

	err := (&BidContract{}).ApproveOpening(l.as(committee1), tenderID)
	require.ErrorContains(t, err, "already approved", "the same member must not count twice")

	require.NoError(t, (&BidContract{}).ApproveOpening(l.as(committee2), tenderID))
	got, _ = (&TenderContract{}).ReadTender(l.as(auditor), tenderID)
	require.True(t, got.OpeningApproved)
	require.Len(t, got.Approvals, 2)
	require.Equal(t, "OpeningApproved", l.lastEvent().Name)

	// Approver references are hashes, not names (NFR-03)
	for _, ref := range got.Approvals {
		require.NoError(t, checkHash("approver", ref))
	}
}

func TestApproveOpening_RequiresCommitteeRole(t *testing.T) {
	l := newLedger(t)
	publish(t, l)
	err := (&BidContract{}).ApproveOpening(l.at(closing).as(officer), tenderID)
	require.ErrorContains(t, err, `role "officer"`)
}

// FR-BID-05, FR-BID-06
func TestOpenBid_AfterClosingAndQuorum(t *testing.T) {
	l := openTender(t)
	require.NoError(t, (&BidContract{}).OpenBid(l.as(officer), tenderID, "BID-001", hash(7)))

	b, _ := (&BidContract{}).ReadBid(l.as(auditor), tenderID, "BID-001")
	require.True(t, b.Opened)
	require.Equal(t, hash(7), b.PlainHash)
	require.Equal(t, hash(3), b.CipherHash, "the submitted cipher hash must not change")
	require.Equal(t, "BidOpened", l.lastEvent().Name)

	err := (&BidContract{}).OpenBid(l.as(officer), tenderID, "BID-001", hash(7))
	require.ErrorContains(t, err, "already been opened")
}

// NFR-02: no bid can be opened early, with or without approvals.
func TestOpenBid_BlockedWithoutQuorum(t *testing.T) {
	l := newLedger(t)
	publish(t, l)
	_, _ = submit(l, "BID-001", "SUP-alpha", 3)

	err := (&BidContract{}).OpenBid(l.as(officer), tenderID, "BID-001", hash(7))
	require.ErrorContains(t, err, "not closed")

	l.at(closing)
	err = (&BidContract{}).OpenBid(l.as(officer), tenderID, "BID-001", hash(7))
	require.ErrorContains(t, err, "needs 2 committee approvals; it has 0")

	require.NoError(t, (&BidContract{}).ApproveOpening(l.as(committee1), tenderID))
	err = (&BidContract{}).OpenBid(l.as(officer), tenderID, "BID-001", hash(7))
	require.ErrorContains(t, err, "it has 1")
}

func TestOpenBid_UnknownBid(t *testing.T) {
	l := openTender(t)
	err := (&BidContract{}).OpenBid(l.as(officer), tenderID, "BID-999", hash(7))
	require.ErrorContains(t, err, "does not exist")
}

func TestGetBidsForTender_InKeyOrder(t *testing.T) {
	l := newLedger(t)
	publish(t, l)
	_, _ = submit(l, "BID-003", "SUP-charlie", 5)
	_, _ = submit(l, "BID-001", "SUP-alpha", 3)
	_, _ = submit(l, "BID-002", "SUP-bravo", 4)

	bids, err := (&BidContract{}).GetBidsForTender(l.as(auditor), tenderID)
	require.NoError(t, err)
	require.Len(t, bids, 3)
	require.Equal(t, []string{"BID-001", "BID-002", "BID-003"}, []string{bids[0].ID, bids[1].ID, bids[2].ID})

	empty, err := (&BidContract{}).GetBidsForTender(l.as(auditor), "OTHER-1")
	require.NoError(t, err)
	require.Empty(t, empty)
}
