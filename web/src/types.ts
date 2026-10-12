export type MonitorStatus = 'up' | 'down' | 'paused' | 'pending';

export interface User {
  id: number;
  email: string;
  slug: string;
}

export interface WindowStats {
  checks: number;
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

export interface Monitor {
  id: number;
  name: string;
  url: string;
  intervalSec: number;
  timeoutMs: number;
  isPaused: boolean;
  isPublic: boolean;
  createdAt: number;
  lastCheckedAt: number | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  status: MonitorStatus;
}

export interface MonitorOverview extends Monitor {
  stats: WindowStats;
  buckets: Bucket[];
}

export interface Check {
  id: number;
  checkedAt: number;
  ok: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  error: string | null;
}

export interface Incident {
  id: number;
  startedAt: number;
  endedAt: number | null;
  lastError: string | null;
}

export interface MonitorInput {
  name: string;
  url: string;
  intervalSec: number;
  isPublic: boolean;
}

export interface PublicMonitor {
  id: number;
  name: string;
  status: MonitorStatus;
  uptime24h: number | null;
  uptime7d: number | null;
  buckets: Bucket[];
}

export interface PublicStatus {
  slug: string;
  overall: 'operational' | 'degraded' | 'unknown';
  monitors: PublicMonitor[];
  generatedAt: number;
}

export interface CheckEvent {
  type: 'check';
  monitorId: number;
  ok: boolean;
  status: 'up' | 'down';
  latencyMs: number | null;
  checkedAt: number;
}
