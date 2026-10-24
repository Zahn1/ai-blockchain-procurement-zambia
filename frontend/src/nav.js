// Sidebar sections for each role (3.5.1: each role sees only its own functions).
import { Building2, ClipboardCheck, FileBarChart, FileSignature, Gavel, Globe2, LayoutDashboard, Send, ShieldAlert, Users } from 'lucide-react';

export const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, roles: ['ADMIN', 'OFFICER', 'SUPPLIER', 'COMMITTEE', 'INSPECTOR', 'REGULATOR'] },
  { to: '/tenders', label: 'Tenders', icon: Gavel, roles: ['OFFICER'] },
  { to: '/bids', label: 'My bids', icon: Send, roles: ['SUPPLIER'] },
  { to: '/evaluation', label: 'Evaluation', icon: ClipboardCheck, roles: ['OFFICER', 'COMMITTEE'] },
  { to: '/contracts', label: 'Contracts', icon: FileSignature, roles: ['OFFICER', 'INSPECTOR'] },
  { to: '/oversight', label: 'Risk alerts', icon: ShieldAlert, roles: ['REGULATOR'] },
  { to: '/reports', label: 'Reports', icon: FileBarChart, roles: ['OFFICER', 'REGULATOR'] },
  { to: '/admin/users', label: 'Users', icon: Users, roles: ['ADMIN'] },
  { to: '/admin/bidders', label: 'Bidders and entities', icon: Building2, roles: ['ADMIN'] },
  { to: '/public', label: 'Public portal', icon: Globe2, roles: ['ADMIN', 'OFFICER', 'SUPPLIER', 'COMMITTEE', 'INSPECTOR', 'REGULATOR'] },
];

export const navFor = (role) => NAV.filter((n) => n.roles.includes(role));
