import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { LatencyChart } from '../components/LatencyChart';
import { MonitorDialog } from '../components/MonitorDialog';
import { StatusPill } from '../components/StatusPill';
import { UptimeBar } from '../components/UptimeBar';
import { useAuth } from '../auth';
import { useLiveUpdates } from '../hooks/useLiveUpdates';
import { useNow } from '../hooks/useNow';
import { formatDuration, formatInterval, formatMs, formatUptime, timeAgo } from '../lib/format';
import type { Bucket, Check, Incident, Monitor, WindowStats } from '../types';

interface Stats {
  last24h: WindowStats;
  last7d: WindowStats;
  last30d: WindowStats;
}

const RANGES = [
  { label: '24 hours', hours: 24, count: 96 },
  { label: '7 days', hours: 168, count: 84 },
] as const;

export function MonitorPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const now = useNow();
  const { demo } = useAuth();

  const [monitor, setMonitor] = useState<Monitor | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [chart, setChart] = useState<Bucket[]>([]);
  const [strip, setStrip] = useState<Bucket[]>([]);
  const [checks, setChecks] = useState<Check[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [range, setRange] = useState<(typeof RANGES)[number]>(RANGES[0]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const [m, s, c, st, ch, inc] = await Promise.all([
        api.monitor(id),
        api.stats(id),
        api.buckets(id, range.hours, range.count),
        api.buckets(id, 24, 48),
        api.checks(id, 25),
        api.incidents(id),
      ]);
      setMonitor(m);
      setStats(s);
      setChart(c);
      setStrip(st);
      setChecks(ch);
      setIncidents(inc);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 404 ? 'Monitor not found' : (err as Error).message);
    }
  }, [id, range]);

  useEffect(() => {
    void load();
    return () => window.clearTimeout(timer.current);
  }, [load]);

  useLiveUpdates((event) => {
    if (event.monitorId !== id) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void load(), 800);
  });

  if (error) {
    return (
      <>
        <Link to="/">← All monitors</Link>
        <p className="error">{error}</p>
      </>
    );
  }
  if (!monitor || !stats) return <p className="muted">Loading…</p>;

  async function togglePause() {
    if (!monitor) return;
    setMonitor(await api.updateMonitor(monitor.id, { isPaused: !monitor.isPaused }));
  }

  async function remove() {
    if (!monitor) return;
    await api.deleteMonitor(monitor.id);
    navigate('/');
  }

  const windows = [
    { label: '24 hours', s: stats.last24h },
    { label: '7 days', s: stats.last7d },
    { label: '30 days', s: stats.last30d },
  ];

  return (
    <>
      <Link to="/" className="back">
        ← All monitors
      </Link>

      <div className="row between wrap head">
        <div>
          <h1>{monitor.name}</h1>
          <a href={monitor.url} className="muted url" target="_blank" rel="noreferrer noopener">
            {monitor.url}
          </a>
          <div className="muted small-text">
            Checked every {formatInterval(monitor.intervalSec)} · last check {timeAgo(monitor.lastCheckedAt, now)}
            {monitor.isPublic ? ' · on public status page' : ''}
          </div>
        </div>
        <div className="row">
          <StatusPill status={monitor.status} />
        </div>
      </div>

      {monitor.status === 'down' && monitor.lastError && <p className="banner bad">Currently failing: {monitor.lastError}</p>}

      {!demo && (
      <div className="row actions">
        <button className="btn" onClick={() => void togglePause()}>
          {monitor.isPaused ? 'Resume' : 'Pause'}
        </button>
        <button className="btn" onClick={() => setEditing(true)}>
          Edit
        </button>
        {confirmDelete ? (
          <>
            <button className="btn danger" onClick={() => void remove()}>
              Yes, delete it
            </button>
            <button className="btn" onClick={() => setConfirmDelete(false)}>
              Keep
            </button>
          </>
        ) : (
          <button className="btn" onClick={() => setConfirmDelete(true)}>
            Delete
          </button>
        )}
      </div>
      )}

      <section className="grid-3">
        {windows.map(({ label, s }) => (
          <div key={label} className="card">
            <div className="muted small-text">Uptime · {label}</div>
            <div className="big">{formatUptime(s.uptime)}</div>
            <div className="muted small-text">
              {s.checks.toLocaleString()} checks · avg {formatMs(s.avgLatencyMs)} · p95 {formatMs(s.p95LatencyMs)}
            </div>
          </div>
        ))}
      </section>

      <section className="card">
        <div className="row between wrap">
          <h2>Response time</h2>
          <div className="segmented" role="group" aria-label="Time range">
            {RANGES.map((r) => (
              <button key={r.hours} className={r.hours === range.hours ? 'active' : ''} onClick={() => setRange(r)}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <LatencyChart buckets={chart} hours={range.hours} />
      </section>

      <section className="card">
        <h2>Last 24 hours</h2>
        <UptimeBar buckets={strip} hours={24} />
      </section>

      <section className="card">
        <h2>Incidents</h2>
        {incidents.length === 0 ? (
          <p className="muted">No incidents recorded. An incident opens after two consecutive failed checks.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Started</th>
                <th>Duration</th>
                <th>Status</th>
                <th>Last error</th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((i) => (
                <tr key={i.id}>
                  <td>{new Date(i.startedAt).toLocaleString()}</td>
                  <td>{formatDuration((i.endedAt ?? now) - i.startedAt)}</td>
                  <td>{i.endedAt ? <span className="tag good">Resolved</span> : <span className="tag bad">Ongoing</span>}</td>
                  <td className="muted">{i.lastError ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>Recent checks</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Result</th>
                <th>HTTP</th>
                <th>Response</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {checks.map((c) => (
                <tr key={c.id}>
                  <td>{new Date(c.checkedAt).toLocaleTimeString()}</td>
                  <td>{c.ok ? <span className="tag good">Up</span> : <span className="tag bad">Down</span>}</td>
                  <td>{c.statusCode ?? '—'}</td>
                  <td>{formatMs(c.latencyMs)}</td>
                  <td className="muted">{c.error ?? ''}</td>
                </tr>
              ))}
              {checks.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    Waiting for the first check…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {editing && (
        <MonitorDialog
          monitor={monitor}
          onClose={() => setEditing(false)}
          onSaved={(updated) => {
            setMonitor(updated);
            setEditing(false);
            void load();
          }}
        />
      )}
    </>
  );
}
