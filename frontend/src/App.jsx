import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import Layout from './components/Layout.jsx';
import { Spinner } from './components/ui.jsx';
import SignIn from './pages/SignIn.jsx';
import Dashboard from './pages/Dashboard.jsx';
import ComingSoon from './pages/ComingSoon.jsx';
import { NAV } from './nav.js';

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
          {NAV.filter((n) => n.to !== '/' && n.roles.includes(user.role)).map((n) => (
            <Route key={n.to} path={n.to} element={<ComingSoon title={n.label} />} />
          ))}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      )}
    </Routes>
  );
}
