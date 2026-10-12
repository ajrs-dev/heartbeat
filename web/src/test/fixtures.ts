import type { Bucket, Monitor, MonitorOverview, PublicMonitor } from '../types';

export const bucket = (total: number, ok: number, avgLatencyMs: number | null = total ? 100 : null, index = 0): Bucket => ({
  index,
  total,
  ok,
  avgLatencyMs,
});

/** 48 healthy buckets. */
export const healthyBuckets = (): Bucket[] => Array.from({ length: 48 }, (_, i) => bucket(30, 30, 100, i));

export const monitor = (overrides: Partial<Monitor> = {}): Monitor => ({
  id: 1,
  name: 'Marketing site',
  url: 'https://example.com/health',
  intervalSec: 60,
  timeoutMs: 10_000,
  isPaused: false,
  isPublic: false,
  createdAt: 1_700_000_000_000,
  lastCheckedAt: Date.now() - 10_000,
  lastLatencyMs: 87,
  lastError: null,
  status: 'up',
  ...overrides,
});

export const overview = (overrides: Partial<MonitorOverview> = {}): MonitorOverview => ({
  ...monitor(),
  stats: { checks: 1440, uptime: 99.93, avgLatencyMs: 90, p95LatencyMs: 140 },
  buckets: healthyBuckets(),
  ...overrides,
});

export const publicMonitor = (overrides: Partial<PublicMonitor> = {}): PublicMonitor => ({
  id: 1,
  name: 'Public API',
  status: 'up',
  uptime24h: 99.9,
  uptime7d: 99.5,
  buckets: healthyBuckets(),
  ...overrides,
});
