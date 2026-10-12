import { bucketTone, formatMs, formatUptime } from '../lib/format';
import type { Bucket } from '../types';

interface Props {
  buckets: Bucket[];
  /** Total span covered, used to label each bar's tooltip. */
  hours: number;
}

/** A status-page style strip: one bar per time slot, coloured by how healthy that slot was. */
export function UptimeBar({ buckets, hours }: Props) {
  const slotMs = (hours * 3_600_000) / Math.max(1, buckets.length);
  const now = Date.now();
  const checks = buckets.reduce((n, b) => n + b.total, 0);
  const ok = buckets.reduce((n, b) => n + b.ok, 0);

  return (
    <div
      className="uptime-bar"
      role="img"
      aria-label={`Uptime over the last ${hours} hours: ${checks ? formatUptime((ok / checks) * 100) : 'no data'}`}
    >
      {buckets.map((b) => {
        const end = now - (buckets.length - 1 - b.index) * slotMs;
        const label = new Date(end).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const detail = b.total
          ? `${formatUptime((b.ok / b.total) * 100)} up · ${b.total} checks${b.avgLatencyMs !== null ? ` · ${formatMs(b.avgLatencyMs)}` : ''}`
          : 'No data';
        return <span key={b.index} className={`bar bar-${bucketTone(b.total, b.ok)}`} title={`${label}\n${detail}`} />;
      })}
    </div>
  );
}
