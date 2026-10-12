import type { CheckResult } from './checker.js';
import { all, get, run, type DB } from './db.js';

export interface MonitorRow {
  id: number;
  user_id: number;
  name: string;
  url: string;
  interval_sec: number;
  timeout_ms: number;
  is_paused: number;
  is_public: number;
  created_at: number;
  last_checked_at: number | null;
  last_ok: number | null;
  last_latency_ms: number | null;
  last_error: string | null;
}

export interface IncidentRow {
  id: number;
  monitor_id: number;
  started_at: number;
  ended_at: number | null;
  last_error: string | null;
}

/**
 * Stores a check result, updates the monitor's cached "last" fields, and maintains incidents.
 *
 * An incident opens on the *second* consecutive failure (and is back-dated to the first), so a
 * single dropped request doesn't page anyone, and closes on the next success.
 */
export function recordCheck(db: DB, monitor: Pick<MonitorRow, 'id'>, result: CheckResult, checkedAt: number): number {
  db.exec('BEGIN');
  try {
    const { id: checkId } = run(
      db,
      'INSERT INTO checks (monitor_id, checked_at, ok, status_code, latency_ms, error) VALUES (?, ?, ?, ?, ?, ?)',
      monitor.id,
      checkedAt,
      result.ok ? 1 : 0,
      result.statusCode,
      result.latencyMs,
      result.error,
    );

    run(
      db,
      'UPDATE monitors SET last_checked_at = ?, last_ok = ?, last_latency_ms = ?, last_error = ? WHERE id = ?',
      checkedAt,
      result.ok ? 1 : 0,
      result.latencyMs,
      result.error,
      monitor.id,
    );

    const open = get<{ id: number }>(db, 'SELECT id FROM incidents WHERE monitor_id = ? AND ended_at IS NULL', monitor.id);
    if (result.ok) {
      if (open) run(db, 'UPDATE incidents SET ended_at = ? WHERE id = ?', checkedAt, open.id);
    } else if (open) {
      run(db, 'UPDATE incidents SET last_error = ? WHERE id = ?', result.error, open.id);
    } else {
      const previous = get<{ ok: number; checked_at: number }>(
        db,
        'SELECT ok, checked_at FROM checks WHERE monitor_id = ? AND id < ? ORDER BY id DESC LIMIT 1',
        monitor.id,
        checkId,
      );
      if (previous && previous.ok === 0) {
        run(
          db,
          'INSERT INTO incidents (monitor_id, started_at, last_error) VALUES (?, ?, ?)',
          monitor.id,
          previous.checked_at,
          result.error,
        );
      }
    }

    db.exec('COMMIT');
    return checkId;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function dueMonitors(db: DB, now: number, limit: number): MonitorRow[] {
  return all<MonitorRow>(
    db,
    `SELECT * FROM monitors
     WHERE is_paused = 0
       AND (last_checked_at IS NULL OR last_checked_at + interval_sec * 1000 <= ?)
     ORDER BY COALESCE(last_checked_at, 0)
     LIMIT ?`,
    now,
    limit,
  );
}

export function pruneOldData(db: DB, retentionDays: number, now: number): void {
  run(db, 'DELETE FROM checks WHERE checked_at < ?', now - retentionDays * 86_400_000);
  run(db, 'DELETE FROM sessions WHERE expires_at < ?', now);
}
