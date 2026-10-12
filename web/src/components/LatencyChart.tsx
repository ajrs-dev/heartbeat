import { formatMs } from '../lib/format';
import type { Bucket } from '../types';

interface Props {
  buckets: Bucket[];
  hours: number;
}

const W = 720;
const H = 200;
const PAD = { top: 12, right: 12, bottom: 24, left: 52 };

/** Rounds up to a "nice" axis maximum (e.g. 137 ms -> 150 ms) so gridlines land on tidy numbers. */
function niceMax(value: number): number {
  if (value <= 0) return 10;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 1.5, 2, 3, 5, 7.5, 10]) {
    if (value <= step * magnitude) return step * magnitude;
  }
  return 10 * magnitude;
}

/** Dependency-free SVG line chart of average latency per time slot. Failed/empty slots leave gaps. */
export function LatencyChart({ buckets, hours }: Props) {
  const points = buckets.map((b) => b.avgLatencyMs);
  const values = points.filter((p): p is number => p !== null);

  if (values.length === 0) {
    return <div className="chart-empty">No latency data in this period yet.</div>;
  }

  const max = niceMax(Math.max(...values));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (buckets.length === 1 ? innerW / 2 : (i / (buckets.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;

  // Split into continuous runs so a missing slot breaks the line instead of drawing a false slope.
  const runs: Array<Array<[number, number]>> = [];
  let current: Array<[number, number]> = [];
  points.forEach((p, i) => {
    if (p === null) {
      if (current.length) runs.push(current);
      current = [];
    } else {
      current.push([x(i), y(p)]);
    }
  });
  if (current.length) runs.push(current);

  const ticks = [0, 0.5, 1].map((f) => f * max);
  const axisLabel = (hoursAgo: number) => (hoursAgo === 0 ? 'now' : hoursAgo >= 24 ? `${Math.round(hoursAgo / 24)}d ago` : `${Math.round(hoursAgo)}h ago`);

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Average response time over the last ${hours} hours`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="grid" />
          <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" className="axis">
            {formatMs(t)}
          </text>
        </g>
      ))}
      {[1, 0.5, 0].map((f) => (
        <text key={f} x={PAD.left + (1 - f) * innerW} y={H - 6} textAnchor={f === 1 ? 'start' : f === 0 ? 'end' : 'middle'} className="axis">
          {axisLabel(hours * f)}
        </text>
      ))}
      {runs.map((run, i) =>
        run.length === 1 ? (
          <circle key={i} cx={run[0]![0]} cy={run[0]![1]} r={2.5} className="line-dot" />
        ) : (
          <g key={i}>
            <path
              d={`M${run[0]![0]},${PAD.top + innerH} ${run.map(([px, py]) => `L${px},${py}`).join(' ')} L${run[run.length - 1]![0]},${PAD.top + innerH} Z`}
              className="area"
            />
            <polyline points={run.map(([px, py]) => `${px},${py}`).join(' ')} className="line" />
          </g>
        ),
      )}
    </svg>
  );
}
