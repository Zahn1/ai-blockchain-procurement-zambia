// The signed-in shell: sidebar with the role's sections, top bar with the user and sign-out.
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Landmark, LogOut, Menu, X } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import { NAV, navGroups } from '../nav.js';
import { ROLE_NAMES } from '../lib/format.js';

export function Wordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-700 text-white"><Landmark className="h-4 w-4" aria-hidden /></span>
      <div className="leading-tight">
        <p className="text-sm font-semibold text-slate-900">Transparent Procurement</p>
        <p className="text-xs text-slate-500">Republic of Zambia</p>
      </div>
    </div>
  );
}

// A section is only current on its own path when another section lives under it (e.g. /oversight and /oversight/history)
const exact = (to) => to === '/' || NAV.some((n) => n.to.startsWith(`${to}/`));

function Sidebar({ onNavigate }) {
  const { user } = useAuth();
  return (
    <div className="flex h-full flex-col border-r border-slate-200 bg-white">
      <div className="flex h-16 items-center border-b border-slate-200 px-5"><Wordmark /></div>
      <nav aria-label="Main" className="flex-1 space-y-5 overflow-y-auto px-3 py-5">
        {navGroups(user.role).map(([group, items]) => (
          <div key={group}>
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{group}</p>
            <ul className="space-y-0.5">
              {items.map(({ to, label, icon: Icon }) => (
                <li key={to}>
                  <NavLink to={to} end={exact(to)} onClick={onNavigate}
                    className={({ isActive }) => `flex min-h-9 items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors duration-150 ${
                      isActive ? 'bg-brand-50 font-semibold text-brand-700' : 'font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900'}`}>
                    <Icon className="h-4 w-4 shrink-0" aria-hidden /> {label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-slate-200 px-5 py-4 text-xs leading-relaxed text-slate-500">
        Ledger shared by ZPPA and the Office of the Auditor General
      </div>
    </div>
  );
}

export default function Layout() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen lg:flex">
      <aside className="hidden w-64 shrink-0 lg:block"><div className="fixed inset-y-0 w-64"><Sidebar /></div></aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute inset-y-0 left-0 w-64"><Sidebar onNavigate={() => setOpen(false)} /></div>
        </div>
      )}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 sm:px-6">
          <button type="button" className="flex h-11 w-11 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(!open)} aria-label={open ? 'Close menu' : 'Open menu'}>
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <div className="ml-auto flex items-center gap-3 sm:gap-5">
            <div className="hidden text-right leading-tight sm:block">
              <p className="text-sm font-medium text-slate-900">{user.name}</p>
              <p className="text-xs text-slate-500">{ROLE_NAMES[user.role]}{user.companyName ? ` · ${user.companyName}` : ''}</p>
            </div>
            <span className="h-8 w-px bg-slate-200" aria-hidden />
            <button type="button" onClick={() => signOut()} className="inline-flex min-h-9 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-900">
              <LogOut className="h-4 w-4" aria-hidden /> Sign out
            </button>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8"><Outlet /></main>
      </div>
    </div>
  );
}
