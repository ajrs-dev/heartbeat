import { all, get, type DB } from './db.js';

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export interface WindowStats {
  checks: number;
  /** Percentage of successful checks, or null when there are no checks in the window. */
  uptime: number | null;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
}

export interface Bucket {
  index: number;
  total: number;
  ok: number;
  avgLatencyMs: number | null;
}

/** Nearest-rank percentile of an ascending-sorted array. */
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil(p * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!;
}

export function windowStats(db: DB, monitorId: number, windowMs: number, now: number): WindowStats {
  const since = now - windowMs;
  const totals = get<{ total: number; ok: number | null }>(
    db,
    'SELECT COUNT(*) AS total, SUM(ok) AS ok FROM checks WHERE monitor_id = ? AND checked_at >= ?',
    monitorId,
    since,
  )!;
  if (totals.total === 0) return { checks: 0, uptime: null, avgLatencyMs: null, p95LatencyMs: null };

  // Latency only makes sense for checks that got a response, and sorting in SQLite keeps the
  // percentile a plain array lookup. At the minimum 30s interval a 24h window is ~2,900 rows.
  const latencies = all<{ latency_ms: number }>(
    db,
    `SELECT latency_ms FROM checks
     WHERE monitor_id = ? AND checked_at >= ? AND ok = 1 AND latency_ms IS NOT NULL
     ORDER BY latency_ms`,
    monitorId,
    since,
  ).map((r) => r.latency_ms);

  const avg = latencies.length ? latencies.reduce((sum, n) => sum + n, 0) / latencies.length : null;
  return {
    checks: totals.total,
    uptime: ((totals.ok ?? 0) / totals.total) * 100,
    avgLatencyMs: avg === null ? null : Math.round(avg),
    p95LatencyMs: percentile(latencies, 0.95),
  };
}

/** Splits the last `hours` into `count` equal buckets and aggregates checks into each one. */
export function buckets(db: DB, monitorId: number, hours: number, count: number, now: number): Bucket[] {
  const span = hours * HOUR;
  const size = Math.max(1, Math.floor(span / count));
  const start = now - span;

  const rows = all<{ b: number; total: number; ok: number; avg: number | null }>(
    db,
    `SELECT CAST((checked_at - ?) / ? AS INTEGER) AS b,
            COUNT(*) AS total,
            SUM(ok)  AS ok,
            AVG(CASE WHEN ok = 1 THEN latency_ms END) AS avg
     FROM checks
     WHERE monitor_id = ? AND checked_at >= ?
     GROUP BY b`,
    start,
    size,
    monitorId,
    start,
  );

  const result: Bucket[] = Array.from({ length: count }, (_, index) => ({
    index,
    total: 0,
    ok: 0,
    avgLatencyMs: null,
  }));
  for (const row of rows) {
    const slot = result[Math.min(count - 1, Math.max(0, row.b))]!;
    slot.total += row.total;
    slot.ok += row.ok ?? 0;
    slot.avgLatencyMs = row.avg === null ? slot.avgLatencyMs : Math.round(row.avg);
  }
  return result;
}
