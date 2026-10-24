// Shared by the front-end tests: a mocked API and rendering the real app at a path.
import { vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../lib/auth.jsx';
import App from '../App.jsx';

export let calls;
export function serve(user, routes) {
  calls = [];
  sessionStorage.setItem('procurement.token', 'test-token');
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const path = url.replace(/^\/api/, '');
    calls.push({ path, method: init.method ?? 'GET', body: init.body });
    const [status, body] = path === '/auth/me' ? [200, user] : (routes[`${init.method ?? 'GET'} ${path}`] ?? [404, { error: 'Not found' }]);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  });
}
// jsdom cannot attach a real file to a required file input, so submit the form directly rather than via its button
export const submit = (name) => fireEvent.submit(screen.getByRole('button', { name }).closest('form'));
export const at = (path) => render(<MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter>);

