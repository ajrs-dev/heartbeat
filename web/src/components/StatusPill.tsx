import type { MonitorStatus } from '../types';

const LABELS: Record<MonitorStatus, string> = {
  up: 'Operational',
  down: 'Down',
  paused: 'Paused',
  pending: 'Pending',
};

export function StatusPill({ status }: { status: MonitorStatus }) {
  return (
    <span className={`pill pill-${status}`}>
      <span className="dot" aria-hidden="true" />
      {LABELS[status]}
    </span>
  );
}
