package contracts

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

const awardID = "AWD-0042"

// awarded runs a tender through to an award of BID-001 for K140,000.
func awarded(t *testing.T) *ledger {
	t.Helper()
	l := openTender(t)
	require.NoError(t, (&BidContract{}).OpenBid(l.as(officer), tenderID, "BID-001", hash(7)))
	require.NoError(t, (&AwardContract{}).MakeAward(l.as(officer), awardID, tenderID, "BID-001", 140_000_00, hash(8)))
	return l
}

// signed takes an award past the standstill period and signs the contract.
func signed(t *testing.T) *ledger {
	t.Helper()
	l := awarded(t)
	l.at(l.stub.now.Add(StandstillPeriod))
	require.NoError(t, (&AwardContract{}).SignContract(l.as(officer), awardID, hash(10)))
	return l
}

// FR-AWD-01, FR-AWD-02
func TestMakeAward_RecordsAwardAndClosesTender(t *testing.T) {
	l := awarded(t)
	a, err := (&AwardContract{}).ReadAward(l.as(auditor), awardID)
	require.NoError(t, err)
	require.Equal(t, AwardMade, a.Status)
	require.Equal(t, "SUP-alpha", a.SupplierRef, "the supplier comes from the opened bid, not from the caller")
	require.Equal(t, int64(140_000_00), a.Amount)
	require.Equal(t, a.Amount, a.ContractValue)
	require.Equal(t, hash(8), a.EvalHash)
	require.Equal(t, "AwardMade", l.lastEvent().Name)

	tn, _ := (&TenderContract{}).ReadTender(l.as(auditor), tenderID)
	require.Equal(t, TenderAwarded, tn.Status)

	// An awarded tender takes no more awards, amendments or cancellations
	require.ErrorContains(t, (&AwardContract{}).MakeAward(l.as(officer), "AWD-9", tenderID, "BID-002", 1, hash(8)), "AWARDED")
	require.ErrorContains(t, (&TenderContract{}).CancelTender(l.as(officer), tenderID, hash(9)), "AWARDED")
}

func TestMakeAward_RequiresOpenedBid(t *testing.T) {
	l := openTender(t) // approved but BID-001 not yet opened
	err := (&AwardContract{}).MakeAward(l.as(officer), awardID, tenderID, "BID-001", 100, hash(8))
	require.ErrorContains(t, err, "has not been opened")

	err = (&AwardContract{}).MakeAward(l.as(officer), awardID, tenderID, "BID-404", 100, hash(8))
	require.ErrorContains(t, err, "does not exist")
}

func TestMakeAward_Rejections(t *testing.T) {
	l := openTender(t)
	require.NoError(t, (&BidContract{}).OpenBid(l.as(officer), tenderID, "BID-001", hash(7)))
	c := &AwardContract{}
	require.ErrorContains(t, c.MakeAward(l.as(committee1), awardID, tenderID, "BID-001", 100, hash(8)), `role "committee"`)
	require.ErrorContains(t, c.MakeAward(l.as(officer), awardID, tenderID, "BID-001", 0, hash(8)), "positive amount")
	require.ErrorContains(t, c.MakeAward(l.as(officer), awardID, tenderID, "BID-001", 100, "x"), "evaluation hash")
}

// FR-AWD-03, FR-AWD-04
func TestSignContract_OnlyAfterStandstill(t *testing.T) {
	l := awarded(t)
	awardedAt := l.stub.now

	err := (&AwardContract{}).SignContract(l.at(awardedAt.Add(StandstillPeriod-time.Second)).as(officer), awardID, hash(10))
	require.ErrorContains(t, err, "standstill period")

	require.NoError(t, (&AwardContract{}).SignContract(l.at(awardedAt.Add(StandstillPeriod)).as(officer), awardID, hash(10)))
	a, _ := (&AwardContract{}).ReadAward(l.as(auditor), awardID)
	require.Equal(t, ContractSigned, a.Status)
	require.Equal(t, hash(10), a.ContractHash)
	require.Equal(t, "ContractSigned", l.lastEvent().Name)

	require.ErrorContains(t, (&AwardContract{}).SignContract(l.as(officer), awardID, hash(10)), "already SIGNED")
}

func TestStandstill_RegulatorSetsPeriodForFutureAwards(t *testing.T) {
	l := newLedger(t)
	c := &AwardContract{}
	h, err := c.GetStandstillHours(l.as(auditor))
	require.NoError(t, err)
	require.Equal(t, 240, h, "default is 10 days")

	require.ErrorContains(t, c.SetStandstillHours(l.as(officer), 0, hash(12)), `role "officer"`)
	require.ErrorContains(t, c.SetStandstillHours(l.as(auditor), 0, hash(12)), "organisation OAGMSP")
	require.ErrorContains(t, c.SetStandstillHours(l.as(regulator), 721, hash(12)), "between 0 and 720")
	require.ErrorContains(t, c.SetStandstillHours(l.as(regulator), 0, "x"), "reason hash")

	require.NoError(t, c.SetStandstillHours(l.as(regulator), 0, hash(12)))
	require.Equal(t, "StandstillChanged", l.lastEvent().Name)
	h, _ = c.GetStandstillHours(l.as(auditor))
	require.Equal(t, 0, h)
}

func TestStandstill_ZeroAllowsImmediateSignature(t *testing.T) {
	l := openTender(t)
	require.NoError(t, (&AwardContract{}).SetStandstillHours(l.as(regulator), 0, hash(12)))
	require.NoError(t, (&BidContract{}).OpenBid(l.as(officer), tenderID, "BID-001", hash(7)))
	require.NoError(t, (&AwardContract{}).MakeAward(l.as(officer), awardID, tenderID, "BID-001", 100, hash(8)))
	require.NoError(t, (&AwardContract{}).SignContract(l.as(officer), awardID, hash(10)))
}

func TestStandstill_ExistingAwardsKeepTheirEndTime(t *testing.T) {
	l := awarded(t) // made under the 10-day default
	require.NoError(t, (&AwardContract{}).SetStandstillHours(l.as(regulator), 0, hash(12)))
	err := (&AwardContract{}).SignContract(l.as(officer), awardID, hash(10))
	require.ErrorContains(t, err, "standstill period", "a later change must not shorten an existing challenge window")
}

func TestRecordVariation(t *testing.T) {
	l := awarded(t)
	err := (&AwardContract{}).RecordVariation(l.as(officer), awardID, 150_000_00, hash(11))
	require.ErrorContains(t, err, "no signed contract")

	l = signed(t)
	err = (&AwardContract{}).RecordVariation(l.as(officer), awardID, 140_000_00, hash(11))
	require.ErrorContains(t, err, "must raise")

	require.NoError(t, (&AwardContract{}).RecordVariation(l.as(officer), awardID, 154_000_00, hash(11)))
	a, _ := (&AwardContract{}).ReadAward(l.as(auditor), awardID)
	require.Equal(t, int64(154_000_00), a.ContractValue)
	require.Equal(t, int64(140_000_00), a.Amount, "the original award amount stays on record")
	require.Equal(t, 1, a.Variations)
	require.Equal(t, "ContractVaried", l.lastEvent().Name)
}
