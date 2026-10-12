/**
 * Uptime is truncated, not rounded: 99.996% must not display as "100%" while there were failures.
 */
export function formatUptime(uptime: number | null | undefined): string {
  if (uptime === null || uptime === undefined) return '—';
  const truncated = Math.floor(uptime * 100) / 100;
  return `${truncated.toFixed(truncated === 100 || truncated === 0 ? 0 : 2)}%`;
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`.replace(/ 0s$/, '');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`.replace(/ 0m$/, '');
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`.replace(/ 0h$/, '');
}

export function timeAgo(timestamp: number | null | undefined, now: number = Date.now()): string {
  if (timestamp === null || timestamp === undefined) return 'never';
  const seconds = Math.round((now - timestamp) / 1000);
  if (seconds < 5) return 'just now';
  return `${formatDuration(seconds * 1000)} ago`;
}

export function formatInterval(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${Math.round(seconds / 3600)} h`;
}

export type BarTone = 'empty' | 'good' | 'warn' | 'bad';

/** Colour class for one bar of an uptime strip. */
export function bucketTone(total: number, ok: number): BarTone {
  if (total === 0) return 'empty';
  const ratio = ok / total;
  if (ratio === 1) return 'good';
  if (ratio >= 0.9) return 'warn';
  return 'bad';
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
