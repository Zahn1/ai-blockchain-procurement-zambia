package contracts

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func raise(l *ledger, alertID string, score int) error {
	return (&AlertContract{}).RaiseAlert(l.as(aiService), alertID, "tender", tenderID, score, "rf-1.0.0", hash(30))
}

// FR-AI-03
func TestRaiseAlert(t *testing.T) {
	l := newLedger(t)
	require.NoError(t, raise(l, "ALT-001", 87))

	alerts, err := (&AlertContract{}).GetAlertsForSubject(l.as(auditor), tenderID)
	require.NoError(t, err)
	require.Len(t, alerts, 1)
	a := alerts[0]
	require.Equal(t, 87, a.Score)
	require.Equal(t, "rf-1.0.0", a.ModelVersion)
	require.Equal(t, hash(30), a.ExplanationHash)
	require.Equal(t, AlertOpen, a.Status)
	require.Equal(t, "AlertRaised", l.lastEvent().Name)
}

func TestRaiseAlert_Rejections(t *testing.T) {
	c := &AlertContract{}
	cases := []struct {
		name    string
		who     fakeIdentity
		subject string
		score   int
		wantErr string
	}{
		{"officer cannot raise", officer, "tender", 50, `role "officer"`},
		{"auditor org cannot raise", auditor, "tender", 50, "organisation OAGMSP"},
		{"score above 100", aiService, "tender", 101, "between 0 and 100"},
		{"negative score", aiService, "tender", -1, "between 0 and 100"},
		{"unknown subject type", aiService, "supplier", 50, "tender or contract"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			l := newLedger(t)
			err := c.RaiseAlert(l.as(tc.who), "ALT-001", tc.subject, tenderID, tc.score, "rf-1.0.0", hash(30))
			require.ErrorContains(t, err, tc.wantErr)
		})
	}
	l := newLedger(t)
	require.NoError(t, raise(l, "ALT-001", 60))
	require.ErrorContains(t, raise(l, "ALT-001", 60), "already exists")
}

// 3.5.8: cleared, monitor or refer
func TestReviewAlert_DecisionsAndFinality(t *testing.T) {
	l := newLedger(t)
	require.NoError(t, raise(l, "ALT-001", 87))
	c := &AlertContract{}

	require.NoError(t, c.ReviewAlert(l.as(regulator), tenderID, "ALT-001", AlertMonitor, hash(31)))
	require.NoError(t, c.ReviewAlert(l.as(auditor), tenderID, "ALT-001", AlertReferred, hash(32)))
	require.NoError(t, c.ReviewAlert(l.as(regulator), tenderID, "ALT-001", AlertCleared, hash(33)))

	alerts, _ := c.GetAlertsForSubject(l.as(auditor), tenderID)
	a := alerts[0]
	require.Equal(t, AlertCleared, a.Status)
	require.Equal(t, MSPZPPA, a.ReviewerMSP)
	require.Equal(t, hash(33), a.ReasonHash)
	require.NoError(t, checkHash("reviewer", a.ReviewerRef), "reviewers are recorded as hashes, not names")
	require.Equal(t, "AlertReviewed", l.lastEvent().Name)

	err := c.ReviewAlert(l.as(regulator), tenderID, "ALT-001", AlertReferred, hash(34))
	require.ErrorContains(t, err, "CLEARED cannot become", "cleared is final")
}

func TestReviewAlert_Rejections(t *testing.T) {
	l := newLedger(t)
	require.NoError(t, raise(l, "ALT-001", 87))
	c := &AlertContract{}
	require.ErrorContains(t, c.ReviewAlert(l.as(officer), tenderID, "ALT-001", AlertCleared, hash(31)), `role "officer"`)
	require.ErrorContains(t, c.ReviewAlert(l.as(aiService), tenderID, "ALT-001", AlertCleared, hash(31)), `role "ai"`)
	require.ErrorContains(t, c.ReviewAlert(l.as(regulator), tenderID, "ALT-001", "IGNORED", hash(31)), "cannot become")
	require.ErrorContains(t, c.ReviewAlert(l.as(regulator), tenderID, "ALT-404", AlertCleared, hash(31)), "does not exist")
}

func TestGetAlertsForSubject_OnlyThatSubject(t *testing.T) {
	l := newLedger(t)
	require.NoError(t, raise(l, "ALT-002", 70))
	require.NoError(t, raise(l, "ALT-001", 90))
	require.NoError(t, (&AlertContract{}).RaiseAlert(l.as(aiService), "ALT-003", "contract", "AWD-0042", 55, "if-1.0.0", hash(30)))

	alerts, err := (&AlertContract{}).GetAlertsForSubject(l.as(auditor), tenderID)
	require.NoError(t, err)
	require.Equal(t, []string{"ALT-001", "ALT-002"}, []string{alerts[0].ID, alerts[1].ID})
}

// 3.5.8: regulators can list every alert to review it.
func TestGetAllAlerts(t *testing.T) {
	l := newLedger(t)
	require.NoError(t, raise(l, "ALT-001", 90))
	require.NoError(t, (&AlertContract{}).RaiseAlert(l.as(aiService), "ALT-002", "contract", "AWD-0042", 55, "if-1.0.0", hash(30)))
	all, err := (&AlertContract{}).GetAllAlerts(l.as(regulator))
	require.NoError(t, err)
	require.Len(t, all, 2)

	empty, err := (&AlertContract{}).GetAllAlerts(newLedger(t).as(regulator))
	require.NoError(t, err)
	require.Empty(t, empty)
}
