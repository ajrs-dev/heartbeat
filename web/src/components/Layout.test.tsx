import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Layout } from './Layout';

const auth = vi.hoisted(() => ({ demo: false }));
vi.mock('../auth', () => ({
  useAuth: () => ({ user: { id: 1, email: 'me@example.com', slug: 'abc123' }, demo: auth.demo, signOut: vi.fn() }),
}));

const renderLayout = () =>
  render(
    <MemoryRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<p>page content</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  auth.demo = false;
});

describe('Layout', () => {
  it('shows the signed-in user, a public status page link and the page content', () => {
    renderLayout();
    expect(screen.getByText('me@example.com')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Public status page' })).toHaveAttribute('href', '/status/abc123');
    expect(screen.getByText('page content')).toBeInTheDocument();
    expect(screen.queryByText(/Read-only demo/)).not.toBeInTheDocument();
  });

  it('explains what the visitor is looking at in the public demo', () => {
    auth.demo = true;
    renderLayout();
    expect(screen.getByText(/Read-only demo/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Source on GitHub' })).toHaveAttribute('href', 'https://github.com/ajrs-dev/heartbeat');
  });
});
