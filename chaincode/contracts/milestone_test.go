package contracts

import (
	"testing"

	"github.com/stretchr/testify/require"
)

var due = formatTime(t0.AddDate(0, 2, 0))

// withMilestones adds two milestones (K60,000 and K80,000) to a signed K140,000 contract and completes the first.
func withMilestones(t *testing.T) *ledger {
	t.Helper()
	l := signed(t)
	m := &MilestoneContract{}
	require.NoError(t, m.AddMilestone(l.as(officer), awardID, "MS-1", 60_000_00, due))
	require.NoError(t, m.AddMilestone(l.as(officer), awardID, "MS-2", 80_000_00, due))
	require.NoError(t, m.CompleteMilestone(l.as(officer), awardID, "MS-1", hash(20)))
	return l
}

// FR-MIL-01
func TestAddMilestone(t *testing.T) {
	l := withMilestones(t)
	ms, err := (&MilestoneContract{}).GetMilestones(l.as(auditor), awardID)
	require.NoError(t, err)
	require.Len(t, ms, 2)
	require.Equal(t, "MS-1", ms[0].ID)
	require.Equal(t, MilestoneCompleted, ms[0].Status)
	require.Equal(t, MilestonePending, ms[1].Status)
}

func TestAddMilestone_Rejections(t *testing.T) {
	t.Run("contract not signed", func(t *testing.T) {
		l := awarded(t)
		err := (&MilestoneContract{}).AddMilestone(l.as(officer), awardID, "MS-1", 100, due)
		require.ErrorContains(t, err, "no signed contract")
	})
	t.Run("milestones above contract value", func(t *testing.T) {
		l := withMilestones(t) // already K140,000 of K140,000 planned
		err := (&MilestoneContract{}).AddMilestone(l.as(officer), awardID, "MS-3", 1, due)
		require.ErrorContains(t, err, "above the contract value")
	})
	t.Run("duplicate ID", func(t *testing.T) {
		l := signed(t)
		m := &MilestoneContract{}
		require.NoError(t, m.AddMilestone(l.as(officer), awardID, "MS-1", 100, due))
		require.ErrorContains(t, m.AddMilestone(l.as(officer), awardID, "MS-1", 100, due), "already exists")
	})
}

// FR-MIL-02
func TestCompleteMilestone(t *testing.T) {
	l := withMilestones(t)
	m := &MilestoneContract{}
	ms, _ := m.GetMilestones(l.as(auditor), awardID)
	require.Equal(t, hash(20), ms[0].EvidenceHash)
	require.NotEmpty(t, ms[0].CompletedAt)
	require.ErrorContains(t, m.CompleteMilestone(l.as(officer), awardID, "MS-1", hash(20)), "already COMPLETED")
	require.ErrorContains(t, m.CompleteMilestone(l.as(officer), awardID, "MS-9", hash(20)), "does not exist")
}

// FR-MIL-03
func TestRecordPayment_UpdatesMilestoneAndContract(t *testing.T) {
	l := withMilestones(t)
	m := &MilestoneContract{}
	require.NoError(t, m.RecordPayment(l.as(officer), awardID, "MS-1", "PAY-001", 60_000_00, "IFMIS-2026-000917"))

	p, err := m.ReadPayment(l.as(auditor), "PAY-001")
	require.NoError(t, err)
	require.Equal(t, int64(60_000_00), p.Amount)
	require.Equal(t, "IFMIS-2026-000917", p.IFMISRef)

	ms, _ := m.GetMilestones(l.as(auditor), awardID)
	require.Equal(t, int64(60_000_00), ms[0].PaidTotal)
	require.Equal(t, []string{"PAY-001"}, ms[0].PaymentIDs)

	a, _ := (&AwardContract{}).ReadAward(l.as(auditor), awardID)
	require.Equal(t, int64(60_000_00), a.PaidTotal)
	require.Equal(t, "PaymentRecorded", l.lastEvent().Name)
}

// The three payment anomalies from the Phase 1 synthetic data are refused outright by the ledger.
func TestRecordPayment_AnomaliesRefused(t *testing.T) {
	t.Run("payment before completion", func(t *testing.T) {
		l := withMilestones(t)
		err := (&MilestoneContract{}).RecordPayment(l.as(officer), awardID, "MS-2", "PAY-001", 10_000_00, "IFMIS-1")
		require.ErrorContains(t, err, "only after completion")
	})
	t.Run("duplicate payment", func(t *testing.T) {
		l := withMilestones(t)
		m := &MilestoneContract{}
		require.NoError(t, m.RecordPayment(l.as(officer), awardID, "MS-1", "PAY-001", 30_000_00, "IFMIS-1"))
		err := m.RecordPayment(l.as(officer), awardID, "MS-1", "PAY-001", 30_000_00, "IFMIS-1")
		require.ErrorContains(t, err, "already been recorded")
	})
	t.Run("overpayment of a milestone", func(t *testing.T) {
		l := withMilestones(t)
		err := (&MilestoneContract{}).RecordPayment(l.as(officer), awardID, "MS-1", "PAY-001", 60_000_01, "IFMIS-1")
		require.ErrorContains(t, err, "above its amount")
	})
}

// FR-MIL-04: payments cannot exceed the contract value without a variation.
func TestRecordPayment_ContractCeilingAndVariation(t *testing.T) {
	l := signed(t)
	m := &MilestoneContract{}
	require.NoError(t, m.AddMilestone(l.as(officer), awardID, "MS-1", 140_000_00, due))
	require.NoError(t, m.CompleteMilestone(l.as(officer), awardID, "MS-1", hash(20)))
	require.NoError(t, m.RecordPayment(l.as(officer), awardID, "MS-1", "PAY-001", 140_000_00, "IFMIS-1"))

	// Contract fully paid: a further milestone cannot even be planned without a variation
	require.ErrorContains(t, m.AddMilestone(l.as(officer), awardID, "MS-2", 14_000_00, due), "above the contract value")

	require.NoError(t, (&AwardContract{}).RecordVariation(l.as(officer), awardID, 154_000_00, hash(11)))
	require.NoError(t, m.AddMilestone(l.as(officer), awardID, "MS-2", 14_000_00, due))
	require.NoError(t, m.CompleteMilestone(l.as(officer), awardID, "MS-2", hash(21)))
	require.NoError(t, m.RecordPayment(l.as(officer), awardID, "MS-2", "PAY-002", 14_000_00, "IFMIS-2"))

	a, _ := (&AwardContract{}).ReadAward(l.as(auditor), awardID)
	require.Equal(t, a.ContractValue, a.PaidTotal)
}

func TestRecordPayment_RequiresOfficer(t *testing.T) {
	l := withMilestones(t)
	err := (&MilestoneContract{}).RecordPayment(l.as(auditor), awardID, "MS-1", "PAY-001", 100, "IFMIS-1")
	require.ErrorContains(t, err, "organisation OAGMSP")
}
