import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api';
import { FakeEventSource } from '../test/setup';
import { bucket, healthyBuckets, monitor } from '../test/fixtures';
import { MonitorPage } from './MonitorPage';

const auth = vi.hoisted(() => ({ demo: false }));
vi.mock('../auth', () => ({ useAuth: () => ({ demo: auth.demo }) }));

const fns = vi.hoisted(() => ({
  monitor: vi.fn(),
  stats: vi.fn(),
  buckets: vi.fn(),
  checks: vi.fn(),
  incidents: vi.fn(),
  updateMonitor: vi.fn(),
  deleteMonitor: vi.fn(),
}));
vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api')>()), api: fns }));

const window = (uptime: number | null, checks: number) => ({ checks, uptime, avgLatencyMs: 90, p95LatencyMs: 150 });

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/monitors/1']}>
      <Routes>
        <Route path="/" element={<p>All monitors page</p>} />
        <Route path="/monitors/:id" element={<MonitorPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  auth.demo = false;
  for (const fn of Object.values(fns)) fn.mockReset();
  fns.monitor.mockResolvedValue(monitor());
  fns.stats.mockResolvedValue({ last24h: window(99.5, 1440), last7d: window(98.25, 10080), last30d: window(100, 43200) });
  fns.buckets.mockResolvedValue(healthyBuckets());
  fns.checks.mockResolvedValue([
    { id: 2, checkedAt: Date.now() - 20_000, ok: false, statusCode: 503, latencyMs: 40, error: 'HTTP 503' },
    { id: 1, checkedAt: Date.now() - 40_000, ok: true, statusCode: 200, latencyMs: 80, error: null },
  ]);
  fns.incidents.mockResolvedValue([]);
});

describe('MonitorPage', () => {
  it('shows the monitor, its uptime windows and its recent checks', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Marketing site' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'https://example.com/health' })).toHaveAttribute('rel', expect.stringContaining('noopener'));

    expect(screen.getByText('99.50%')).toBeInTheDocument();
    expect(screen.getByText('98.25%')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();

    const rows = within(screen.getByRole('heading', { name: 'Recent checks' }).closest('section')!).getAllByRole('row');
    expect(rows).toHaveLength(3); // header + two checks
    expect(within(rows[1]!).getByText('Down')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('503')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Up')).toBeInTheDocument();
  });

  it('explains when there are no incidents, and lists them when there are', async () => {
    renderPage();
    expect(await screen.findByText(/No incidents recorded/)).toBeInTheDocument();
  });

  it('lists incidents with their duration and state', async () => {
    const start = Date.now() - 10 * 60_000;
    fns.incidents.mockResolvedValue([
      { id: 2, startedAt: Date.now() - 60_000, endedAt: null, lastError: 'Connection refused' },
      { id: 1, startedAt: start, endedAt: start + 5 * 60_000, lastError: 'HTTP 503' },
    ]);
    renderPage();
    const section = (await screen.findByRole('heading', { name: 'Incidents' })).closest('section')!;
    expect(await within(section).findByText('Ongoing')).toBeInTheDocument();
    expect(within(section).getByText('Resolved')).toBeInTheDocument();
    expect(within(section).getByText('5m')).toBeInTheDocument();
    expect(within(section).getByText('Connection refused')).toBeInTheDocument();
  });

  it('shows the current failure prominently when the monitor is down', async () => {
    fns.monitor.mockResolvedValue(monitor({ status: 'down', lastError: 'Timed out after 10000 ms' }));
    renderPage();
    expect(await screen.findByText('Currently failing: Timed out after 10000 ms')).toBeInTheDocument();
  });

  it('pauses and resumes', async () => {
    fns.updateMonitor.mockResolvedValue(monitor({ isPaused: true, status: 'paused' }));
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Pause' }));
    expect(fns.updateMonitor).toHaveBeenCalledWith(1, { isPaused: true });
    expect(await screen.findByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(screen.getByText('Paused')).toBeInTheDocument();
  });

  it('asks for confirmation before deleting, and can be cancelled', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(fns.deleteMonitor).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Keep' }));
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(fns.deleteMonitor).not.toHaveBeenCalled();
  });

  it('deletes after confirmation and returns to the list', async () => {
    fns.deleteMonitor.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete it' }));
    expect(fns.deleteMonitor).toHaveBeenCalledWith(1);
    expect(await screen.findByText('All monitors page')).toBeInTheDocument();
  });

  it('refetches the chart when the time range changes', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: 'Marketing site' });
    expect(fns.buckets).toHaveBeenCalledWith(1, 24, 96);

    await user.click(screen.getByRole('button', { name: '7 days' }));
    await waitFor(() => expect(fns.buckets).toHaveBeenCalledWith(1, 168, 84));
  });

  it('reloads when a check for this monitor arrives, but not for other monitors', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Marketing site' });
    const initialCalls = fns.checks.mock.calls.length;

    vi.useFakeTimers({ shouldAdvanceTime: true });
    const source = FakeEventSource.instances[0]!;
    act(() => source.emit('check', { type: 'check', monitorId: 99, ok: true, status: 'up', latencyMs: 1, checkedAt: 1 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fns.checks).toHaveBeenCalledTimes(initialCalls);

    act(() => source.emit('check', { type: 'check', monitorId: 1, ok: true, status: 'up', latencyMs: 1, checkedAt: 1 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    await waitFor(() => expect(fns.checks.mock.calls.length).toBe(initialCalls + 1));
  });

  it('hides pause, edit and delete in the read-only public demo, but still shows the data', async () => {
    auth.demo = true;
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Marketing site' })).toBeInTheDocument();
    for (const name of ['Pause', 'Resume', 'Edit', 'Delete']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(screen.getByText('99.50%')).toBeInTheDocument();
  });

  it('shows "Monitor not found" for a 404', async () => {
    fns.monitor.mockRejectedValue(new ApiError('Monitor not found', 404));
    renderPage();
    expect(await screen.findByText('Monitor not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← All monitors' })).toBeInTheDocument();
  });

  it('renders a chart with data from the API', async () => {
    fns.buckets.mockResolvedValue([bucket(10, 10, 120, 0), bucket(10, 10, 80, 1)]);
    renderPage();
    expect(await screen.findByRole('img', { name: /Average response time/ })).toBeInTheDocument();
  });
});
