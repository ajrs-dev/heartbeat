import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { type IncidentRow, type MonitorRow } from '../checks.js';
import type { AppContext } from '../context.js';
import { all, get, run, type DB } from '../db.js';
import { HttpError } from '../errors.js';
import { parseTargetUrl } from '../ssrf.js';
import { DAY, buckets, windowStats } from '../stats.js';

export type MonitorStatus = 'up' | 'down' | 'paused' | 'pending';

export function monitorStatus(m: Pick<MonitorRow, 'is_paused' | 'last_ok'>): MonitorStatus {
  if (m.is_paused) return 'paused';
  if (m.last_ok === null) return 'pending';
  return m.last_ok === 1 ? 'up' : 'down';
}

export function serializeMonitor(m: MonitorRow) {
  return {
    id: m.id,
    name: m.name,
    url: m.url,
    intervalSec: m.interval_sec,
    timeoutMs: m.timeout_ms,
    isPaused: m.is_paused === 1,
    isPublic: m.is_public === 1,
    createdAt: m.created_at,
    lastCheckedAt: m.last_checked_at,
    lastLatencyMs: m.last_latency_ms,
    lastError: m.last_error,
    status: monitorStatus(m),
  };
}

function serializeIncident(i: IncidentRow) {
  return { id: i.id, startedAt: i.started_at, endedAt: i.ended_at, lastError: i.last_error };
}

const idParam = z.coerce.number().int().positive();

function findOwned(db: DB, userId: number, rawId: unknown): MonitorRow {
  const id = idParam.safeParse(rawId);
  const monitor = id.success
    ? get<MonitorRow>(db, 'SELECT * FROM monitors WHERE id = ? AND user_id = ?', id.data, userId)
    : undefined;
  // Another user's monitor and a missing one are indistinguishable on purpose.
  if (!monitor) throw new HttpError(404, 'Monitor not found');
  return monitor;
}

export function monitorSchemas(minIntervalSec: number) {
  const fields = {
    name: z.string().trim().min(1, 'Name is required').max(80),
    url: z.string().trim().min(1, 'URL is required').max(2048),
    intervalSec: z.number().int().min(minIntervalSec).max(86_400),
    timeoutMs: z.number().int().min(1_000).max(30_000),
    isPublic: z.boolean(),
    isPaused: z.boolean(),
  };
  return {
    create: z.object({
      name: fields.name,
      url: fields.url,
      intervalSec: fields.intervalSec.default(60),
      timeoutMs: fields.timeoutMs.default(10_000),
      isPublic: fields.isPublic.default(false),
    }),
    update: z
      .object(fields)
      .partial()
      .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update'),
  };
}

export function monitorsRouter(ctx: AppContext): Router {
  const router = Router();
  const schemas = monitorSchemas(ctx.config.minIntervalSec);
  router.use(requireAuth(ctx.db));
  // The public demo account is shared by every visitor, so it is read-only.
  router.use((req, _res, next) => {
    if (ctx.config.demoMode && req.method !== 'GET') throw new HttpError(403, 'The public demo is read-only');
    next();
  });

  /** Everything the dashboard needs in one round trip: each monitor with 24h stats and a mini timeline. */
  router.get('/overview', (req, res) => {
    const now = Date.now();
    const monitors = all<MonitorRow>(ctx.db, 'SELECT * FROM monitors WHERE user_id = ? ORDER BY name COLLATE NOCASE', req.user!.id);
    res.json({
      monitors: monitors.map((m) => ({
        ...serializeMonitor(m),
        stats: windowStats(ctx.db, m.id, DAY, now),
        buckets: buckets(ctx.db, m.id, 24, 48, now),
      })),
    });
  });

  router.get('/', (req, res) => {
    const rows = all<MonitorRow>(ctx.db, 'SELECT * FROM monitors WHERE user_id = ? ORDER BY name COLLATE NOCASE', req.user!.id);
    res.json({ monitors: rows.map(serializeMonitor) });
  });

  router.post('/', (req, res) => {
    const body = schemas.create.parse(req.body);
    const count = get<{ n: number }>(ctx.db, 'SELECT COUNT(*) AS n FROM monitors WHERE user_id = ?', req.user!.id)!.n;
    if (count >= ctx.config.maxMonitorsPerUser) {
      throw new HttpError(409, `You can have at most ${ctx.config.maxMonitorsPerUser} monitors`);
    }
    const url = parseTargetUrl(body.url, ctx.config.allowPrivateTargets, ctx.config.allowedTargets).toString();
    const { id } = run(
      ctx.db,
      `INSERT INTO monitors (user_id, name, url, interval_sec, timeout_ms, is_public, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      req.user!.id,
      body.name,
      url,
      body.intervalSec,
      body.timeoutMs,
      body.isPublic ? 1 : 0,
      Date.now(),
    );
    res.status(201).json({ monitor: serializeMonitor(findOwned(ctx.db, req.user!.id, id)) });
  });

  router.get('/:id', (req, res) => {
    res.json({ monitor: serializeMonitor(findOwned(ctx.db, req.user!.id, req.params.id)) });
  });

  router.patch('/:id', (req, res) => {
    const monitor = findOwned(ctx.db, req.user!.id, req.params.id);
    const body = schemas.update.parse(req.body);
    const url = body.url === undefined ? monitor.url : parseTargetUrl(body.url, ctx.config.allowPrivateTargets, ctx.config.allowedTargets).toString();
    run(
      ctx.db,
      `UPDATE monitors SET name = ?, url = ?, interval_sec = ?, timeout_ms = ?, is_public = ?, is_paused = ? WHERE id = ?`,
      body.name ?? monitor.name,
      url,
      body.intervalSec ?? monitor.interval_sec,
      body.timeoutMs ?? monitor.timeout_ms,
      (body.isPublic ?? monitor.is_public === 1) ? 1 : 0,
      (body.isPaused ?? monitor.is_paused === 1) ? 1 : 0,
      monitor.id,
    );
    res.json({ monitor: serializeMonitor(findOwned(ctx.db, req.user!.id, monitor.id)) });
  });

  router.delete('/:id', (req, res) => {
    const monitor = findOwned(ctx.db, req.user!.id, req.params.id);
    run(ctx.db, 'DELETE FROM monitors WHERE id = ?', monitor.id);
    res.status(204).end();
  });

  router.get('/:id/stats', (req, res) => {
    const monitor = findOwned(ctx.db, req.user!.id, req.params.id);
    const now = Date.now();
    res.json({
      last24h: windowStats(ctx.db, monitor.id, DAY, now),
      last7d: windowStats(ctx.db, monitor.id, 7 * DAY, now),
      last30d: windowStats(ctx.db, monitor.id, 30 * DAY, now),
    });
  });

  router.get('/:id/buckets', (req, res) => {
    const monitor = findOwned(ctx.db, req.user!.id, req.params.id);
    const query = z
      .object({
        hours: z.coerce.number().int().min(1).max(24 * 30).default(24),
        count: z.coerce.number().int().min(1).max(200).default(48),
      })
      .parse(req.query);
    res.json({ buckets: buckets(ctx.db, monitor.id, query.hours, query.count, Date.now()) });
  });

  router.get('/:id/checks', (req, res) => {
    const monitor = findOwned(ctx.db, req.user!.id, req.params.id);
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
    const rows = all<{ id: number; checked_at: number; ok: number; status_code: number | null; latency_ms: number | null; error: string | null }>(
      ctx.db,
      'SELECT id, checked_at, ok, status_code, latency_ms, error FROM checks WHERE monitor_id = ? ORDER BY id DESC LIMIT ?',
      monitor.id,
      limit,
    );
    res.json({
      checks: rows.map((c) => ({
        id: c.id,
        checkedAt: c.checked_at,
        ok: c.ok === 1,
        statusCode: c.status_code,
        latencyMs: c.latency_ms,
        error: c.error,
      })),
    });
  });

  router.get('/:id/incidents', (req, res) => {
    const monitor = findOwned(ctx.db, req.user!.id, req.params.id);
    const rows = all<IncidentRow>(
      ctx.db,
      'SELECT * FROM incidents WHERE monitor_id = ? ORDER BY started_at DESC LIMIT 50',
      monitor.id,
    );
    res.json({ incidents: rows.map(serializeIncident) });
  });

  return router;
}
