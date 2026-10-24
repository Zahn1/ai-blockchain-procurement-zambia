// Sidebar sections for each role (3.5.1: each role sees only its own functions).
import { Building2, ClipboardCheck, FileBarChart, FileSignature, Gavel, Globe2, History, LayoutDashboard, Send, ShieldAlert, Users } from 'lucide-react';

export const NAV = [
  { to: '/', label: 'Dashboard', group: 'Overview', icon: LayoutDashboard, roles: ['ADMIN', 'OFFICER', 'SUPPLIER', 'COMMITTEE', 'INSPECTOR', 'REGULATOR'] },
  { to: '/tenders', label: 'Tenders', group: 'Procurement', icon: Gavel, roles: ['OFFICER'] },
  { to: '/bids', label: 'My bids', group: 'Procurement', icon: Send, roles: ['SUPPLIER'] },
  { to: '/evaluation', label: 'Evaluation', group: 'Procurement', icon: ClipboardCheck, roles: ['OFFICER', 'COMMITTEE'] },
  { to: '/contracts', label: 'Contracts', group: 'Procurement', icon: FileSignature, roles: ['OFFICER', 'INSPECTOR'] },
  { to: '/oversight', label: 'Risk alerts', group: 'Oversight', icon: ShieldAlert, roles: ['REGULATOR'] },
  { to: '/oversight/history', label: 'Procurement history', group: 'Oversight', icon: History, roles: ['REGULATOR'] },
  { to: '/reports', label: 'Reports', group: 'Oversight', icon: FileBarChart, roles: ['OFFICER', 'REGULATOR'] },
  { to: '/admin/users', label: 'Users', group: 'Administration', icon: Users, roles: ['ADMIN'] },
  { to: '/admin/bidders', label: 'Bidders and entities', group: 'Administration', icon: Building2, roles: ['ADMIN'] },
  { to: '/public', label: 'Public portal', group: 'Public', icon: Globe2, roles: ['ADMIN', 'OFFICER', 'SUPPLIER', 'COMMITTEE', 'INSPECTOR', 'REGULATOR'] },
];

export const navFor = (role) => NAV.filter((n) => n.roles.includes(role));

/** The role's sections, in sidebar groups: [[group, items], ...]. */
export const navGroups = (role) => {
  const groups = new Map();
  for (const n of navFor(role)) groups.set(n.group, [...(groups.get(n.group) ?? []), n]);
  return [...groups];
};
