package contracts

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

var due = formatTime(t0.AddDate(0, 2, 0))

// certify has the inspector certify a milestone complete as of the ledger's current time.
func certify(l *ledger, milestoneID string, amount int64, certificate string) error {
	return (&MilestoneContract{}).CompleteMilestone(l.as(inspector), awardID, milestoneID, certificate, amount, formatTime(l.stub.now))
}

// withMilestones adds two milestones (K60,000 and K80,000) to a signed K140,000 contract and completes the first.
func withMilestones(t *testing.T) *ledger {
	t.Helper()
	l := signed(t)
	m := &MilestoneContract{}
	require.NoError(t, m.AddMilestone(l.as(officer), awardID, "MS-1", 60_000_00, due))
	require.NoError(t, m.AddMilestone(l.as(officer), awardID, "MS-2", 80_000_00, due))
	require.NoError(t, certify(l, "MS-1", 60_000_00, hash(20)))
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
	require.ErrorContains(t, certify(l, "MS-1", 60_000_00, hash(20)), "already COMPLETED")
	require.ErrorContains(t, certify(l, "MS-9", 60_000_00, hash(20)), "does not exist")
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
		require.ErrorContains(t, err, "only after an inspector certifies completion")
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
	require.NoError(t, certify(l, "MS-1", 140_000_00, hash(20)))
	require.NoError(t, m.RecordPayment(l.as(officer), awardID, "MS-1", "PAY-001", 140_000_00, "IFMIS-1"))

	// Contract fully paid: a further milestone cannot even be planned without a variation
	require.ErrorContains(t, m.AddMilestone(l.as(officer), awardID, "MS-2", 14_000_00, due), "above the contract value")

	require.NoError(t, (&AwardContract{}).RecordVariation(l.as(officer), awardID, 154_000_00, hash(11)))
	require.NoError(t, m.AddMilestone(l.as(officer), awardID, "MS-2", 14_000_00, due))
	require.NoError(t, certify(l, "MS-2", 14_000_00, hash(21)))
	require.NoError(t, m.RecordPayment(l.as(officer), awardID, "MS-2", "PAY-002", 14_000_00, "IFMIS-2"))

	a, _ := (&AwardContract{}).ReadAward(l.as(auditor), awardID)
	require.Equal(t, a.ContractValue, a.PaidTotal)
}

func TestRecordPayment_RequiresOfficer(t *testing.T) {
	l := withMilestones(t)
	err := (&MilestoneContract{}).RecordPayment(l.as(auditor), awardID, "MS-1", "PAY-001", 100, "IFMIS-1")
	require.ErrorContains(t, err, "organisation OAGMSP")
}

// 3.5.6: only an authorised inspector can certify completion.
func TestCompleteMilestone_OnlyAnInspector(t *testing.T) {
	l := signed(t)
	m := &MilestoneContract{}
	require.NoError(t, m.AddMilestone(l.as(officer), awardID, "MS-1", 60_000_00, due))
	err := m.CompleteMilestone(l.as(officer), awardID, "MS-1", hash(20), 60_000_00, formatTime(l.stub.now))
	require.ErrorContains(t, err, `role "officer"`)
	require.NoError(t, certify(l, "MS-1", 60_000_00, hash(20)))
	ms, _ := m.GetMilestones(l.as(auditor), awardID)
	require.NoError(t, checkHash("inspector", ms[0].CertifiedBy), "the inspector is recorded as a hash, not a name")
}

// 3.5.6: the certificate is checked against the milestone terms.
func TestCompleteMilestone_CertificateCheckedAgainstTerms(t *testing.T) {
	l := signed(t)
	m := &MilestoneContract{}
	require.NoError(t, m.AddMilestone(l.as(officer), awardID, "MS-1", 60_000_00, due))
	signedAt := l.stub.now

	require.ErrorContains(t, certify(l, "MS-1", 50_000_00, hash(20)), "certifies 5000000 ngwee, but milestone MS-1 is for 6000000")
	before := (&MilestoneContract{}).CompleteMilestone(l.as(inspector), awardID, "MS-1", hash(20), 60_000_00, formatTime(signedAt.Add(-time.Hour)))
	require.ErrorContains(t, before, "before the contract was signed")
	future := (&MilestoneContract{}).CompleteMilestone(l.as(inspector), awardID, "MS-1", hash(20), 60_000_00, formatTime(signedAt.Add(time.Hour)))
	require.ErrorContains(t, future, "in the future")
	require.ErrorContains(t, (&MilestoneContract{}).CompleteMilestone(l.as(inspector), awardID, "MS-1", "x", 60_000_00, formatTime(signedAt)), "certificate hash")

	require.NoError(t, certify(l, "MS-1", 60_000_00, hash(20)))
	ms, _ := m.GetMilestones(l.as(auditor), awardID)
	require.Equal(t, hash(20), ms[0].EvidenceHash)
	require.Equal(t, formatTime(signedAt), ms[0].CompletionDate)
}

func raiseOn(t *testing.T, l *ledger, alertID, subjectType, subjectID string, score int) {
	t.Helper()
	require.NoError(t, (&AlertContract{}).RaiseAlert(l.as(aiService), alertID, subjectType, subjectID, score, "rf-1.0.0", hash(30)))
}

// 3.5.6: no payment while the contract or its tender is flagged as high risk.
func TestRecordPayment_BlockedWhileFlaggedHighRisk(t *testing.T) {
	l := withMilestones(t)
	m := &MilestoneContract{}
	raiseOn(t, l, "ALT-1", "contract", awardID, 82)

	check, err := m.CheckPayable(l.as(officer), awardID, "MS-1", 60_000_00)
	require.NoError(t, err)
	require.False(t, check.Payable)
	require.Contains(t, check.Reason, "flagged as high risk (alert ALT-1, score 82, OPEN)")
	err = m.RecordPayment(l.as(officer), awardID, "MS-1", "PAY-001", 60_000_00, "IFMIS-1")
	require.ErrorContains(t, err, "flagged as high risk")

	// Referred keeps it blocked; a decision to monitor releases it
	require.NoError(t, (&AlertContract{}).ReviewAlert(l.as(regulator), awardID, "ALT-1", AlertReferred, hash(31)))
	require.ErrorContains(t, m.RecordPayment(l.as(officer), awardID, "MS-1", "PAY-001", 60_000_00, "IFMIS-1"), "REFERRED")
	require.NoError(t, (&AlertContract{}).ReviewAlert(l.as(regulator), awardID, "ALT-1", AlertCleared, hash(32)))
	check, _ = m.CheckPayable(l.as(officer), awardID, "MS-1", 60_000_00)
	require.True(t, check.Payable)
	require.NoError(t, m.RecordPayment(l.as(officer), awardID, "MS-1", "PAY-001", 60_000_00, "IFMIS-1"))
}

func TestRecordPayment_TenderAlertAlsoBlocks(t *testing.T) {
	l := withMilestones(t)
	raiseOn(t, l, "ALT-T", "tender", tenderID, 90)
	err := (&MilestoneContract{}).RecordPayment(l.as(officer), awardID, "MS-1", "PAY-001", 60_000_00, "IFMIS-1")
	require.ErrorContains(t, err, "tender "+tenderID+" is flagged as high risk")
}

func TestRecordPayment_MonitoredOrLowScoreDoesNotBlock(t *testing.T) {
	l := withMilestones(t)
	m := &MilestoneContract{}
	raiseOn(t, l, "ALT-LOW", "contract", awardID, HighRiskScore-1)
	raiseOn(t, l, "ALT-MON", "contract", awardID, 95)
	require.NoError(t, (&AlertContract{}).ReviewAlert(l.as(regulator), awardID, "ALT-MON", AlertMonitor, hash(31)))
	require.NoError(t, m.RecordPayment(l.as(officer), awardID, "MS-1", "PAY-001", 60_000_00, "IFMIS-1"))
}

func TestCheckPayable_MatchesRecordPayment(t *testing.T) {
	l := withMilestones(t)
	m := &MilestoneContract{}
	early, err := m.CheckPayable(l.as(officer), awardID, "MS-2", 10_000_00)
	require.NoError(t, err)
	require.False(t, early.Payable)
	require.Contains(t, early.Reason, "only after an inspector certifies completion")
	over, _ := m.CheckPayable(l.as(officer), awardID, "MS-1", 60_000_01)
	require.Contains(t, over.Reason, "above its amount")
	ok, _ := m.CheckPayable(l.as(officer), awardID, "MS-1", 60_000_00)
	require.True(t, ok.Payable)
}
