import { Card, PageHeader } from '../components/ui.jsx';

export default function ComingSoon({ title }) {
  return (
    <>
      <PageHeader title={title} />
      <Card><p className="text-sm text-slate-600">This screen is being built in the next step of Phase 5. Until then it is available on the prototype page at http://localhost:3000.</p></Card>
    </>
  );
}
