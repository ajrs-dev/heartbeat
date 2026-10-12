import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api';
import { publicMonitor } from '../test/fixtures';
import type { PublicStatus } from '../types';
import { StatusPage } from './StatusPage';

const { publicStatus } = vi.hoisted(() => ({ publicStatus: vi.fn() }));
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { publicStatus },
}));

const status = (overrides: Partial<PublicStatus> = {}): PublicStatus => ({
  slug: 'demo',
  overall: 'operational',
  monitors: [publicMonitor()],
  generatedAt: 1_700_000_000_000,
  ...overrides,
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/status/demo']}>
      <Routes>
        <Route path="/status/:slug" element={<StatusPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  publicStatus.mockReset();
});

describe('StatusPage', () => {
  it('requests the page for the slug in the URL and shows the overall banner', async () => {
    publicStatus.mockResolvedValue(status());
    renderPage();
    expect(await screen.findByText('All systems operational')).toBeInTheDocument();
    expect(publicStatus).toHaveBeenCalledWith('demo');
  });

  it('lists each public monitor with its health and uptime', async () => {
    publicStatus.mockResolvedValue(
      status({
        overall: 'degraded',
        monitors: [publicMonitor({ id: 1, name: 'Public API', uptime24h: 99.9, uptime7d: 99.5 }), publicMonitor({ id: 2, name: 'Checkout', status: 'down' })],
      }),
    );
    renderPage();

    expect(await screen.findByText('Some systems are experiencing issues')).toBeInTheDocument();
    const api = screen.getByText('Public API').closest('li') as HTMLElement;
    expect(within(api).getByText('Operational')).toBeInTheDocument();
    expect(within(api).getByText(/99\.90% uptime \(24h\) · 99\.50% \(7d\)/)).toBeInTheDocument();
    expect(within(screen.getByText('Checkout').closest('li') as HTMLElement).getByText('Down')).toBeInTheDocument();
  });

  it('handles an account with no public monitors', async () => {
    publicStatus.mockResolvedValue(status({ overall: 'unknown', monitors: [] }));
    renderPage();
    expect(await screen.findByText('No public monitors yet.')).toBeInTheDocument();
    expect(screen.getByText('Status unavailable')).toBeInTheDocument();
  });

  it('shows a friendly message for an unknown status page', async () => {
    publicStatus.mockRejectedValue(new ApiError('Status page not found', 404));
    renderPage();
    expect(await screen.findByText('No status page found here.')).toBeInTheDocument();
  });

  it('does not require a signed-in user', async () => {
    publicStatus.mockResolvedValue(status());
    renderPage(); // no AuthProvider in this tree at all
    expect(await screen.findByText('Public API')).toBeInTheDocument();
  });
});
