import { describe, expect, it } from 'vitest';
import { recordCheck } from '../src/checks.js';
import { all, run } from '../src/db.js';
import { DAY, HOUR, buckets, percentile, windowStats } from '../src/stats.js';
import { makeContext } from './helpers.js';

const NOW = 1_700_000_000_000;

function seed() {
  const { db } = makeContext();
  const user = run(db, 'INSERT INTO users (email, password_hash, slug, created_at) VALUES (?, ?, ?, ?)', 'a@example.com', 'x', 'slug', NOW);
  const monitor = run(
    db,
    'INSERT INTO monitors (user_id, name, url, interval_sec, timeout_ms, created_at) VALUES (?, ?, ?, 60, 10000, ?)',
    user.id,
    'm',
    'https://example.com',
    NOW,
  );
  return { db, monitor: { id: monitor.id } };
}

const up = (latencyMs: number) => ({ ok: true, statusCode: 200, latencyMs, error: null });
const down = (error = 'HTTP 500') => ({ ok: false, statusCode: 500, latencyMs: 20, error });

describe('percentile', () => {
  it('uses the nearest-rank method', () => {
    const data = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(data, 0.5)).toBe(50);
    expect(percentile(data, 0.95)).toBe(95);
    expect(percentile(data, 1)).toBe(100);
    expect(percentile([7], 0.95)).toBe(7);
    expect(percentile([], 0.95)).toBeNull();
  });
});

describe('windowStats', () => {
  it('computes uptime, average and p95 latency over the window only', () => {
    const { db, monitor } = seed();
    for (let i = 0; i < 18; i++) recordCheck(db, monitor, up(100 + i), NOW - HOUR + i * 1000);
    recordCheck(db, monitor, up(900), NOW - 2 * 1000);
    recordCheck(db, monitor, down(), NOW - 1000);
    recordCheck(db, monitor, up(5), NOW - 3 * DAY); // outside the 24h window

    const stats = windowStats(db, monitor.id, DAY, NOW);
    expect(stats.checks).toBe(20);
    expect(stats.uptime).toBeCloseTo(95, 5); // 19 of 20
    expect(stats.p95LatencyMs).toBe(900);
    // 19 successful checks: 100..117 (sum 1953) plus 900 => 2853 / 19 = 150.2
    expect(stats.avgLatencyMs).toBe(150);
    expect(windowStats(db, monitor.id, 7 * DAY, NOW).checks).toBe(21);
  });

  it('reports null uptime when there is no data', () => {
    const { db, monitor } = seed();
    expect(windowStats(db, monitor.id, DAY, NOW)).toEqual({ checks: 0, uptime: null, avgLatencyMs: null, p95LatencyMs: null });
  });
});

describe('buckets', () => {
  it('places checks in the right slot and fills empty ones', () => {
    const { db, monitor } = seed();
    // 4 buckets over 4 hours: one check in the oldest, two (one failing) in the newest.
    recordCheck(db, monitor, up(100), NOW - 4 * HOUR + 1000);
    recordCheck(db, monitor, up(200), NOW - 1000);
    recordCheck(db, monitor, down(), NOW - 2000);

    const result = buckets(db, monitor.id, 4, 4, NOW);
    expect(result).toHaveLength(4);
    expect(result[0]).toMatchObject({ total: 1, ok: 1, avgLatencyMs: 100 });
    expect(result[1]).toMatchObject({ total: 0, ok: 0, avgLatencyMs: null });
    expect(result[2]).toMatchObject({ total: 0 });
    expect(result[3]).toMatchObject({ total: 2, ok: 1, avgLatencyMs: 200 });
  });
});

describe('incident tracking', () => {
  const incidents = (db: ReturnType<typeof seed>['db']) =>
    all<{ started_at: number; ended_at: number | null; last_error: string | null }>(db, 'SELECT * FROM incidents ORDER BY id');

  it('does not open an incident for a single failure', () => {
    const { db, monitor } = seed();
    recordCheck(db, monitor, up(50), NOW);
    recordCheck(db, monitor, down(), NOW + 60_000);
    recordCheck(db, monitor, up(50), NOW + 120_000);
    expect(incidents(db)).toHaveLength(0);
  });

  it('opens on the second consecutive failure, back-dated to the first, and closes on recovery', () => {
    const { db, monitor } = seed();
    recordCheck(db, monitor, up(50), NOW);
    recordCheck(db, monitor, down('HTTP 500'), NOW + 60_000);
    recordCheck(db, monitor, down('Timed out after 10000 ms'), NOW + 120_000);
    recordCheck(db, monitor, down('Connection refused'), NOW + 180_000);

    let [incident] = incidents(db);
    expect(incidents(db)).toHaveLength(1);
    expect(incident).toMatchObject({ started_at: NOW + 60_000, ended_at: null, last_error: 'Connection refused' });

    recordCheck(db, monitor, up(60), NOW + 240_000);
    [incident] = incidents(db);
    expect(incident!.ended_at).toBe(NOW + 240_000);
  });

  it('keeps a monitor row in sync with its latest check', () => {
    const { db, monitor } = seed();
    recordCheck(db, monitor, down('Connection refused'), NOW);
    const row = all<{ last_ok: number; last_error: string; last_checked_at: number }>(db, 'SELECT * FROM monitors WHERE id = ?', monitor.id)[0]!;
    expect(row).toMatchObject({ last_ok: 0, last_error: 'Connection refused', last_checked_at: NOW });
  });
});
