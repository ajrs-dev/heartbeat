import { Router } from 'express';
import type { MonitorRow } from '../checks.js';
import type { AppContext } from '../context.js';
import { all, get } from '../db.js';
import { HttpError } from '../errors.js';
import { DAY, buckets, windowStats } from '../stats.js';
import { monitorStatus } from './monitors.js';

/** Read-only status page data. Exposes names and health only, never URLs or error details. */
export function publicRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/:slug', (req, res) => {
    const user = get<{ id: number; slug: string }>(ctx.db, 'SELECT id, slug FROM users WHERE slug = ?', req.params.slug);
    if (!user) throw new HttpError(404, 'Status page not found');

    const now = Date.now();
    const monitors = all<MonitorRow>(
      ctx.db,
      'SELECT * FROM monitors WHERE user_id = ? AND is_public = 1 ORDER BY name COLLATE NOCASE',
      user.id,
    );
    const items = monitors.map((m) => ({
      id: m.id,
      name: m.name,
      status: monitorStatus(m),
      uptime24h: windowStats(ctx.db, m.id, DAY, now).uptime,
      uptime7d: windowStats(ctx.db, m.id, 7 * DAY, now).uptime,
      buckets: buckets(ctx.db, m.id, 24, 48, now),
    }));

    const overall = items.some((m) => m.status === 'down')
      ? 'degraded'
      : items.length > 0 && items.every((m) => m.status === 'up' || m.status === 'paused')
        ? 'operational'
        : 'unknown';
    res.json({ slug: user.slug, overall, monitors: items, generatedAt: now });
  });

  return router;
}
