import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { Logo } from '../components/Layout';
import { StatusPill } from '../components/StatusPill';
import { UptimeBar } from '../components/UptimeBar';
import { formatUptime } from '../lib/format';
import type { PublicStatus } from '../types';

const BANNER = {
  operational: { text: 'All systems operational', tone: 'good' },
  degraded: { text: 'Some systems are experiencing issues', tone: 'bad' },
  unknown: { text: 'Status unavailable', tone: 'muted' },
} as const;

/** The public, read-only status page. No sign-in required. */
export function StatusPage() {
  const { slug = '' } = useParams();
  const [status, setStatus] = useState<PublicStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .publicStatus(slug)
        .then((s) => !cancelled && (setStatus(s), setError(null)))
        .catch((err) => !cancelled && setError(err instanceof ApiError && err.status === 404 ? 'No status page found here.' : (err as Error).message));
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [slug]);

  return (
    <div className="container narrow">
      <header className="status-head">
        <Logo />
      </header>

      {error && <p className="error">{error}</p>}
      {!status && !error && <p className="muted">Loading…</p>}

      {status && (
        <>
          <div className={`banner ${BANNER[status.overall].tone}`}>{BANNER[status.overall].text}</div>
          {status.monitors.length === 0 && <p className="muted">No public monitors yet.</p>}
          <ul className="list">
            {status.monitors.map((m) => (
              <li key={m.id} className="card">
                <div className="row between">
                  <strong>{m.name}</strong>
                  <StatusPill status={m.status} />
                </div>
                <UptimeBar buckets={m.buckets} hours={24} />
                <div className="row between muted small-text">
                  <span>24h ago</span>
                  <span>
                    {formatUptime(m.uptime24h)} uptime (24h) · {formatUptime(m.uptime7d)} (7d)
                  </span>
                  <span>now</span>
                </div>
              </li>
            ))}
          </ul>
          <p className="muted small-text center">Updated {new Date(status.generatedAt).toLocaleTimeString()} · refreshes every 30 seconds</p>
        </>
      )}
    </div>
  );
}
