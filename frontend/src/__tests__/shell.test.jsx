// Front end, step 1: each role sees only its own sections (3.5.1) and sign-in starts with the password.
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { navFor } from '../nav.js';
import { kwacha, kwachaShort } from '../lib/format.js';
import { AuthProvider } from '../lib/auth.jsx';
import SignIn from '../pages/SignIn.jsx';

describe('navigation by role', () => {
  const labels = (role) => navFor(role).map((n) => n.label);
  test.each([
    ['SUPPLIER', ['Dashboard', 'My bids', 'Public portal']],
    ['REGULATOR', ['Dashboard', 'Risk alerts', 'Procurement history', 'Reports', 'Public portal']],
    ['INSPECTOR', ['Dashboard', 'Contracts', 'Public portal']],
  ])('%s sees only its own sections', (role, expected) => {
    expect(labels(role)).toEqual(expected);
  });

  test('only administrators manage users', () => {
    for (const role of ['OFFICER', 'SUPPLIER', 'COMMITTEE', 'INSPECTOR', 'REGULATOR']) expect(labels(role)).not.toContain('Users');
    expect(labels('ADMIN')).toContain('Users');
  });
});

test('amounts are shown in kwacha, in UK format', () => {
  expect(kwacha(13_850_000)).toBe('K138,500.00');
  expect(kwachaShort(52_900_000)).toBe('K529k');
  expect(kwachaShort(250_000_000)).toBe('K2.5m');
});

test('sign-in starts with email and password, and links to registration and the public portal', () => {
  render(<MemoryRouter><AuthProvider><SignIn /></AuthProvider></MemoryRouter>);
  expect(screen.getByLabelText('Email')).toBeInTheDocument();
  expect(screen.getByLabelText('Password')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Register as a bidder' })).toHaveAttribute('href', '/register');
  expect(screen.getByRole('link', { name: /search and verify public records/ })).toHaveAttribute('href', '/public');
});
