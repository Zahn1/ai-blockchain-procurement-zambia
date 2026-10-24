// Reports (3.5.10): procurement, payment and alert reports, as PDF or spreadsheet.
import { useState } from 'react';
import { FileSpreadsheet, FileText } from 'lucide-react';
import { download } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { Button, Card, Message, PageHeader } from '../components/ui.jsx';

// As REPORT_ROLES in the back end
const REPORTS = [
  ['procurement', 'Procurement report', 'Every tender with its buyer, dates, estimate, number of bids, ledger status, winner and contract value.', ['OFFICER', 'REGULATOR']],
  ['payments', 'Payment report', 'Every milestone payment made through IFMIS, with its reference and the ledger transaction.', ['OFFICER', 'REGULATOR']],
  ['alerts', 'Risk alert report', 'Every AI risk alert with its score and status, and the latest regulator decision with its reason.', ['REGULATOR']],
];

export default function Reports() {
  const { user } = useAuth();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function get(kind, format) {
    setBusy(`${kind}.${format}`);
    setError('');
    try { await download(`/reports/${kind}?format=${format}`); } catch (err) { setError(err.message); } finally { setBusy(''); }
  }

  return (
    <>
      <PageHeader title="Reports" description="Built from the ledger and the system's records when you download them. Each download is written to the audit log." />
      {error && <div className="mb-4"><Message tone="error">{error}</Message></div>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {REPORTS.filter(([, , , roles]) => roles.includes(user.role)).map(([kind, title, text]) => (
          <Card key={kind} title={title}>
            <p className="min-h-[3.75rem] text-sm text-slate-600">{text}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="secondary" busy={busy === `${kind}.pdf`} onClick={() => get(kind, 'pdf')}><FileText className="h-4 w-4" aria-hidden /> PDF</Button>
              <Button variant="secondary" busy={busy === `${kind}.xlsx`} onClick={() => get(kind, 'xlsx')}><FileSpreadsheet className="h-4 w-4" aria-hidden /> Spreadsheet</Button>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
