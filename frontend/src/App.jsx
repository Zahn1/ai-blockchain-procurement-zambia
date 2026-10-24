import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import Layout from './components/Layout.jsx';
import { Spinner } from './components/ui.jsx';
import SignIn from './pages/SignIn.jsx';
import Dashboard from './pages/Dashboard.jsx';
import ComingSoon from './pages/ComingSoon.jsx';
import Tenders from './pages/Tenders.jsx';
import PublishTender from './pages/PublishTender.jsx';
import TenderDetail from './pages/TenderDetail.jsx';
import Bids from './pages/Bids.jsx';
import SubmitBid from './pages/SubmitBid.jsx';
import Evaluation from './pages/Evaluation.jsx';
import EvaluationTender from './pages/EvaluationTender.jsx';
import Contracts from './pages/Contracts.jsx';
import ContractDetail from './pages/ContractDetail.jsx';
import { NAV } from './nav.js';

// Built sections; the rest show a placeholder until their step of Phase 5
const PAGES = { '/tenders': Tenders, '/bids': Bids, '/evaluation': Evaluation, '/contracts': Contracts };

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner label="Signing you in…" />;
  return (
    <Routes>
      {/* Open to everyone (3.5.2 registration, 3.5.9 public portal) */}
      <Route path="/register" element={<ComingSoon title="Register as a bidder" />} />
      {!user && <Route path="/public" element={<ComingSoon title="Public portal" />} />}
      {!user ? (
        <Route path="*" element={<SignIn />} />
      ) : (
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          {NAV.filter((n) => n.to !== '/' && n.roles.includes(user.role)).map(({ to, label }) => {
            const Page = PAGES[to];
            return <Route key={to} path={to} element={Page ? <Page /> : <ComingSoon title={label} />} />;
          })}
          <Route path="/tender" element={<TenderDetail />} />
          {user.role === 'OFFICER' && <Route path="/tenders/new" element={<PublishTender />} />}
          {user.role === 'SUPPLIER' && <Route path="/bids/new" element={<SubmitBid />} />}
          {['OFFICER', 'COMMITTEE'].includes(user.role) && <Route path="/evaluation/tender" element={<EvaluationTender />} />}
          {['OFFICER', 'INSPECTOR'].includes(user.role) && <Route path="/contracts/detail" element={<ContractDetail />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      )}
    </Routes>
  );
}
