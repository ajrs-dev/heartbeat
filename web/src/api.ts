import type {
  Bucket,
  Check,
  Incident,
  Monitor,
  MonitorInput,
  MonitorOverview,
  PublicStatus,
  User,
  WindowStats,
} from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export const api = {
  config: () => request<{ demoMode: boolean }>('GET', '/config'),
  demoLogin: () => request<{ user: User }>('POST', '/auth/demo').then((r) => r.user),
  me: () => request<{ user: User }>('GET', '/auth/me').then((r) => r.user),
  login: (email: string, password: string) => request<{ user: User }>('POST', '/auth/login', { email, password }).then((r) => r.user),
  register: (email: string, password: string) =>
    request<{ user: User }>('POST', '/auth/register', { email, password }).then((r) => r.user),
  logout: () => request<void>('POST', '/auth/logout'),

  overview: () => request<{ monitors: MonitorOverview[] }>('GET', '/monitors/overview').then((r) => r.monitors),
  monitor: (id: number) => request<{ monitor: Monitor }>('GET', `/monitors/${id}`).then((r) => r.monitor),
  createMonitor: (input: MonitorInput) => request<{ monitor: Monitor }>('POST', '/monitors', input).then((r) => r.monitor),
  updateMonitor: (id: number, patch: Partial<MonitorInput & { isPaused: boolean }>) =>
    request<{ monitor: Monitor }>('PATCH', `/monitors/${id}`, patch).then((r) => r.monitor),
  deleteMonitor: (id: number) => request<void>('DELETE', `/monitors/${id}`),
  stats: (id: number) =>
    request<{ last24h: WindowStats; last7d: WindowStats; last30d: WindowStats }>('GET', `/monitors/${id}/stats`),
  buckets: (id: number, hours: number, count: number) =>
    request<{ buckets: Bucket[] }>('GET', `/monitors/${id}/buckets?hours=${hours}&count=${count}`).then((r) => r.buckets),
  checks: (id: number, limit = 30) => request<{ checks: Check[] }>('GET', `/monitors/${id}/checks?limit=${limit}`).then((r) => r.checks),
  incidents: (id: number) => request<{ incidents: Incident[] }>('GET', `/monitors/${id}/incidents`).then((r) => r.incidents),

  publicStatus: (slug: string) => request<PublicStatus>('GET', `/public/${encodeURIComponent(slug)}`),
};
