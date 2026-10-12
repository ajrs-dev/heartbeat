import { Router } from 'express';
import { requireAuth } from '../auth.js';
import type { AppContext } from '../context.js';

/** Server-sent events: one long-lived response per open dashboard, fed by the scheduler's EventHub. */
export function eventsRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/', requireAuth(ctx.db), (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // stop nginx buffering the stream
    });
    res.write('retry: 3000\n\n');

    const unsubscribe = ctx.hub.subscribe(req.user!.id, (event) => {
      res.write(`event: check\ndata: ${JSON.stringify(event)}\n\n`);
    });
    // A comment line every 25s keeps proxies and browsers from closing an idle connection.
    const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 25_000);

    req.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  return router;
}
