// Tenders to evaluate (3.5.5): every tender for an officer, the member's own for the committee.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { when } from '../lib/format.js';
import { Badge, Card, Message, PageHeader, Spinner, Table } from '../components/ui.jsx';

export const evaluationLink = (reference) => `/evaluation/tender?ref=${encodeURIComponent(reference)}`;

/** The next thing that has to happen, in words. */
export function evaluationStage(t) {
  if (t.awarded) return ['Awarded', 'brand'];
  if (t.recommended) return ['Recommended, awaiting award', 'success'];
  if (!t.closed) return [t.committee ? 'Open for bids' : 'Open for bids, no committee yet', t.committee ? 'success' : 'warning'];
  if (!t.committee) return ['Committee to be appointed', 'warning'];
  if (t.bids && t.opened < t.bids) return ['Awaiting opening', 'warning'];
  return ['Being scored', 'info'];
}

export default function Evaluation() {
  const { user } = useAuth();
  const [tenders, setTenders] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/evaluation/tenders').then(setTenders).catch((e) => setError(e.message)); }, []);
  const member = user.role === 'COMMITTEE';

  return (
    <>
      <PageHeader title="Evaluation" description={member
        ? 'Tenders you are appointed to evaluate. Bids open only after the closing time and the committee\'s approvals on the ledger.'
        : 'Appoint each tender\'s evaluation committee and follow its progress from opening to recommendation.'} />
      {error && <Message tone="error">{error}</Message>}
      <Card padded={false}>
        {!tenders ? <Spinner /> : (
          <Table rows={tenders} rowKey={(t) => t.reference} empty={member ? 'You have not been appointed to a committee yet.' : 'No tenders yet.'} columns={[
            { key: 'reference', label: 'Reference', mono: true, render: (t) => <Link to={evaluationLink(t.reference)} className="font-medium text-brand-700 hover:underline">{t.reference}</Link> },
            { key: 'title', label: 'Title', wide: true },
            { key: 'closingTime', label: 'Closes', nowrap: true, render: (t) => when(t.closingTime) },
            { key: 'bids', label: 'Bids', align: 'right', nowrap: true, render: (t) => (t.opened ? `${t.opened} of ${t.bids} opened` : t.bids) },
            { key: 'approvals', label: 'Opening approvals', align: 'right', nowrap: true, render: (t) => (t.committee ? `${t.approvals} of ${t.committee}` : '–') },
            { key: 'stage', label: 'Next step', render: (t) => { const [label, tone] = evaluationStage(t); return <Badge tone={tone}>{label}</Badge>; } },
          ]} />
        )}
      </Card>
    </>
  );
}
