// The frame for pages anyone can open without signing in: sign-in, bidder registration and the public portal.
import { NavLink } from 'react-router-dom';
import { Wordmark } from './Layout.jsx';

const link = ({ isActive }) => `rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150 ${
  isActive ? 'text-brand-700' : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'}`;

export default function PublicShell({ children, width = 'max-w-5xl' }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className={`mx-auto flex h-16 ${width} items-center justify-between gap-4 px-4 sm:px-6`}>
          <NavLink to="/" aria-label="Transparent Procurement, home"><Wordmark /></NavLink>
          <nav aria-label="Public" className="flex items-center gap-1">
            <NavLink to="/public" className={link}>Public records</NavLink>
            <NavLink to="/" end className={link}>Sign in</NavLink>
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-slate-200 bg-white">
        <div className={`mx-auto flex ${width} flex-wrap justify-between gap-2 px-4 py-4 text-xs text-slate-500 sm:px-6`}>
          <span>Records are held on a ledger shared by ZPPA and the Office of the Auditor General.</span>
          <span>ZCAS University · BSc Information Technology project</span>
        </div>
      </footer>
    </div>
  );
}
