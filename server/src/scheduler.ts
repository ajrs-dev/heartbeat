import { runCheck, type CheckResult } from './checker.js';
import { dueMonitors, pruneOldData, recordCheck, type MonitorRow } from './checks.js';
import type { Config } from './config.js';
import type { DB } from './db.js';
import type { EventHub } from './events.js';

type CheckFn = (url: string, timeoutMs: number, allowPrivate: boolean) => Promise<CheckResult>;

/**
 * Runs due checks. A one-second tick asks the database which monitors are due, then runs them
 * with bounded concurrency. Using the database as the source of truth (rather than one timer per
 * monitor) means pausing, editing and deleting monitors never needs to touch scheduler state, and
 * the schedule survives a restart.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private inFlight = new Set<number>();
  private lastPrune = 0;

  constructor(
    private readonly db: DB,
    private readonly config: Config,
    private readonly hub: EventHub,
    private readonly check: CheckFn = runCheck,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.config.schedulerTickMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Runs one scheduling pass and resolves when every check it started has been recorded. */
  async tick(now: number = Date.now()): Promise<void> {
    if (now - this.lastPrune > 3_600_000) {
      this.lastPrune = now;
      pruneOldData(this.db, this.config.retentionDays, now);
    }

    const capacity = this.config.maxConcurrentChecks - this.inFlight.size;
    if (capacity <= 0) return;

    const due = dueMonitors(this.db, now, capacity + this.inFlight.size).filter((m) => !this.inFlight.has(m.id));
    await Promise.all(due.slice(0, capacity).map((monitor) => this.execute(monitor, now)));
  }

  private async execute(monitor: MonitorRow, startedAt: number): Promise<void> {
    this.inFlight.add(monitor.id);
    try {
      const result = await this.check(monitor.url, monitor.timeout_ms, this.config.allowPrivateTargets);
      recordCheck(this.db, monitor, result, startedAt);
      this.hub.emit(monitor.user_id, {
        type: 'check',
        monitorId: monitor.id,
        ok: result.ok,
        status: result.ok ? 'up' : 'down',
        latencyMs: result.latencyMs,
        checkedAt: startedAt,
      });
    } catch (err) {
      // The monitor may have been deleted while its check was in flight. Never crash the loop.
      if (!(err instanceof Error && /FOREIGN KEY|constraint/i.test(err.message))) {
        console.error(`check for monitor ${monitor.id} failed to record:`, err);
      }
    } finally {
      this.inFlight.delete(monitor.id);
    }
  }
}
