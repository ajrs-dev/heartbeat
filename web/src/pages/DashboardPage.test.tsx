import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeEventSource } from '../test/setup';
import { monitor, overview } from '../test/fixtures';
import { DashboardPage } from './DashboardPage';

const { overviewFn, createMonitor, auth } = vi.hoisted(() => ({ overviewFn: vi.fn(), createMonitor: vi.fn(), auth: { demo: false } }));
vi.mock('../auth', () => ({ useAuth: () => ({ demo: auth.demo }) }));
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { overview: overviewFn, createMonitor },
}));

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/monitors/:id" element={<p>Monitor detail page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const card = (name: string) => screen.getByRole('link', { name }).closest('li') as HTMLElement;

beforeEach(() => {
  auth.demo = false;
  overviewFn.mockReset();
  createMonitor.mockReset();
});

describe('DashboardPage', () => {
  it('shows an empty state with a call to action when there are no monitors', async () => {
    overviewFn.mockResolvedValue([]);
    renderDashboard();
    expect(await screen.findByRole('heading', { name: 'No monitors yet' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Add your first monitor' })).toBeInTheDocument();
  });

  it('summarises a healthy fleet and shows per-monitor numbers', async () => {
    overviewFn.mockResolvedValue([
      overview({ id: 1, name: 'Marketing site', url: 'https://example.com/health' }),
      overview({ id: 2, name: 'Public API', url: 'https://api.example.com' }),
    ]);
    renderDashboard();

    expect(await screen.findByRole('heading', { name: 'All systems operational' })).toBeInTheDocument();
    const first = within(card('Marketing site'));
    expect(first.getByText('Operational')).toBeInTheDocument();
    expect(first.getByText('99.93%')).toBeInTheDocument(); // uptime 24h
    expect(first.getByText('87 ms')).toBeInTheDocument(); // last response
    expect(first.getByText('90 ms')).toBeInTheDocument(); // average
    expect(first.getByText('140 ms')).toBeInTheDocument(); // p95
    expect(first.getByText(/example\.com · every 1 min/)).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: /Uptime over the last 24 hours/ })).toHaveLength(2);
  });

  it('flags down monitors in the headline and shows their last error', async () => {
    overviewFn.mockResolvedValue([
      overview({ id: 1, name: 'Marketing site' }),
      overview({ id: 2, name: 'Checkout', status: 'down', lastError: 'Connection refused' }),
    ]);
    renderDashboard();

    expect(await screen.findByRole('heading', { name: '1 monitor is down' })).toBeInTheDocument();
    expect(within(card('Checkout')).getByText('Last error: Connection refused')).toBeInTheDocument();
    expect(within(card('Marketing site')).queryByText(/Last error/)).not.toBeInTheDocument();
  });

  it('does not count paused monitors as down or up', async () => {
    overviewFn.mockResolvedValue([overview({ id: 1, name: 'A' }), overview({ id: 2, name: 'B', status: 'paused' })]);
    renderDashboard();
    expect(await screen.findByRole('heading', { name: 'All systems operational' })).toBeInTheDocument();
    expect(within(card('B')).getByText('Paused')).toBeInTheDocument();
  });

  it('shows an error if the monitors cannot be loaded', async () => {
    overviewFn.mockRejectedValue(new Error('Network down'));
    renderDashboard();
    expect(await screen.findByText('Network down')).toBeInTheDocument();
  });

  it('opens the add dialog and goes to the new monitor after saving', async () => {
    overviewFn.mockResolvedValue([]);
    createMonitor.mockResolvedValue(monitor({ id: 42 }));
    const user = userEvent.setup();
    renderDashboard();

    await user.click((await screen.findAllByRole('button', { name: '+ Add monitor' }))[0]!);
    const dialog = screen.getByRole('dialog', { name: 'Add monitor' });
    await user.type(within(dialog).getByLabelText('Name'), 'New');
    await user.clear(within(dialog).getByLabelText(/^URL/));
    await user.type(within(dialog).getByLabelText(/^URL/), 'https://new.example.com');
    await user.click(within(dialog).getByRole('button', { name: 'Add monitor' }));

    expect(await screen.findByText('Monitor detail page')).toBeInTheDocument();
  });
});

describe('DashboardPage in the read-only public demo', () => {
  it('offers no way to add monitors', async () => {
    auth.demo = true;
    overviewFn.mockResolvedValue([overview()]);
    renderDashboard();
    expect(await screen.findByRole('heading', { name: 'All systems operational' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add monitor/i })).not.toBeInTheDocument();
  });

  it('does not invite visitors to add a first monitor either', async () => {
    auth.demo = true;
    overviewFn.mockResolvedValue([]);
    renderDashboard();
    expect(await screen.findByRole('heading', { name: 'No monitors yet' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add monitor/i })).not.toBeInTheDocument();
  });
});

describe('DashboardPage live updates', () => {
  it('reports whether the live connection is up', async () => {
    overviewFn.mockResolvedValue([overview()]);
    renderDashboard();
    expect(await screen.findByText('Reconnecting…')).toBeInTheDocument();

    const source = FakeEventSource.instances[0]!;
    expect(source.url).toBe('/api/events');
    act(() => source.open());
    expect(screen.getByText('Live updates on')).toBeInTheDocument();
    act(() => source.onerror?.());
    expect(screen.getByText('Reconnecting…')).toBeInTheDocument();
  });

  it('updates a card the moment a failed check is pushed, then reconciles with the server', async () => {
    overviewFn.mockResolvedValue([overview({ id: 1, name: 'Marketing site' })]);
    renderDashboard();
    expect(await screen.findByRole('heading', { name: 'All systems operational' })).toBeInTheDocument();
    expect(overviewFn).toHaveBeenCalledTimes(1);

    vi.useFakeTimers({ shouldAdvanceTime: true });
    overviewFn.mockResolvedValue([overview({ id: 1, name: 'Marketing site', status: 'down', lastError: 'HTTP 503' })]);

    act(() =>
      FakeEventSource.instances[0]!.emit('check', {
        type: 'check',
        monitorId: 1,
        ok: false,
        status: 'down',
        latencyMs: 55,
        checkedAt: Date.now(),
      }),
    );

    // Immediate optimistic update from the event itself...
    expect(within(card('Marketing site')).getByText('Down')).toBeInTheDocument();
    expect(within(card('Marketing site')).getByText('55 ms')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '1 monitor is down' })).toBeInTheDocument();
    expect(overviewFn).toHaveBeenCalledTimes(1);

    // ...followed by one debounced refetch for the authoritative stats.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    await waitFor(() => expect(overviewFn).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Last error: HTTP 503')).toBeInTheDocument();
  });

  it('ignores events for monitors it does not show', async () => {
    overviewFn.mockResolvedValue([overview({ id: 1, name: 'Marketing site' })]);
    renderDashboard();
    await screen.findByRole('heading', { name: 'All systems operational' });

    act(() =>
      FakeEventSource.instances[0]!.emit('check', { type: 'check', monitorId: 999, ok: false, status: 'down', latencyMs: 1, checkedAt: 1 }),
    );
    expect(within(card('Marketing site')).getByText('Operational')).toBeInTheDocument();
  });

  it('closes the event stream on unmount', async () => {
    overviewFn.mockResolvedValue([overview()]);
    const { unmount } = renderDashboard();
    await screen.findByRole('heading', { name: 'All systems operational' });
    const source = FakeEventSource.instances[0]!;
    unmount();
    expect(source.closed).toBe(true);
  });
});
