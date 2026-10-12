import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { MonitorDialog } from '../components/MonitorDialog';
import { StatusPill } from '../components/StatusPill';
import { UptimeBar } from '../components/UptimeBar';
import { useLiveUpdates } from '../hooks/useLiveUpdates';
import { useNow } from '../hooks/useNow';
import { formatInterval, formatMs, formatUptime, hostOf, timeAgo } from '../lib/format';
import type { MonitorOverview } from '../types';

export function DashboardPage() {
  const navigate = useNavigate();
  const now = useNow();
  const [monitors, setMonitors] = useState<MonitorOverview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const refreshTimer = useRef<number | undefined>(undefined);

  const refresh = useCallback(() => {
    api
      .overview()
      .then((m) => {
        setMonitors(m);
        setError(null);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    refresh();
    return () => window.clearTimeout(refreshTimer.current);
  }, [refresh]);

  const live = useLiveUpdates((event) => {
    // Update the card immediately for responsiveness, then reconcile stats with the server.
    setMonitors((prev) =>
      prev
        ? prev.map((m) =>
            m.id === event.monitorId ? { ...m, status: event.status, lastLatencyMs: event.latencyMs, lastCheckedAt: event.checkedAt } : m,
          )
        : prev,
    );
    window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(refresh, 2000);
  });

  if (error && !monitors) return <p className="error">{error}</p>;
  if (!monitors) return <p className="muted">Loading…</p>;

  const active = monitors.filter((m) => m.status !== 'paused');
  const down = active.filter((m) => m.status === 'down').length;
  const headline =
    monitors.length === 0
      ? 'No monitors yet'
      : down > 0
        ? down === 1
          ? '1 monitor is down'
          : `${down} monitors are down`
        : active.length > 0 && active.every((m) => m.status === 'up')
          ? 'All systems operational'
          : 'Waiting for first checks';

  return (
    <>
      <div className="row between wrap">
        <div>
          <h1 className={down > 0 ? 'headline bad' : 'headline'}>{headline}</h1>
          <p className="muted live">
            <span className={`live-dot ${live ? 'on' : ''}`} aria-hidden="true" />
            {live ? 'Live updates on' : 'Reconnecting…'}
          </p>
        </div>
        <button className="btn primary" onClick={() => setAdding(true)}>
          + Add monitor
        </button>
      </div>

      {monitors.length === 0 ? (
        <div className="card empty">
          <h2>Add your first monitor</h2>
          <p className="muted">Paste a URL and Heartbeat will check it on a schedule, track uptime and response time, and open an incident if it goes down.</p>
          <button className="btn primary" onClick={() => setAdding(true)}>
            + Add monitor
          </button>
        </div>
      ) : (
        <ul className="list">
          {monitors.map((m) => (
            <li key={m.id} className="card monitor">
              <div className="row between wrap">
                <div className="grow">
                  <Link to={`/monitors/${m.id}`} className="monitor-name">
                    {m.name}
                  </Link>
                  <div className="muted small-text">
                    {hostOf(m.url)} · every {formatInterval(m.intervalSec)} · checked {timeAgo(m.lastCheckedAt, now)}
                  </div>
                </div>
                <StatusPill status={m.status} />
              </div>
              <UptimeBar buckets={m.buckets} hours={24} />
              <div className="metrics">
                <div>
                  <span className="metric-value">{formatUptime(m.stats.uptime)}</span>
                  <span className="metric-label">uptime 24h</span>
                </div>
                <div>
                  <span className="metric-value">{formatMs(m.lastLatencyMs)}</span>
                  <span className="metric-label">last response</span>
                </div>
                <div>
                  <span className="metric-value">{formatMs(m.stats.avgLatencyMs)}</span>
                  <span className="metric-label">avg 24h</span>
                </div>
                <div>
                  <span className="metric-value">{formatMs(m.stats.p95LatencyMs)}</span>
                  <span className="metric-label">p95 24h</span>
                </div>
              </div>
              {m.status === 'down' && m.lastError && <p className="error small-text">Last error: {m.lastError}</p>}
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <MonitorDialog
          onClose={() => setAdding(false)}
          onSaved={(created) => {
            setAdding(false);
            navigate(`/monitors/${created.id}`);
          }}
        />
      )}
    </>
  );
}
