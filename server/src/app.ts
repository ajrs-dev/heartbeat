import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { type ErrorRequestHandler, type NextFunction, type Request, type Response } from 'express';
import { ZodError } from 'zod';
import type { AppContext } from './context.js';
import { HttpError } from './errors.js';
import { authRouter } from './routes/auth.js';
import { eventsRouter } from './routes/events.js';
import { monitorsRouter } from './routes/monitors.js';
import { publicRouter } from './routes/public.js';

function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
  );
  next();
}

/**
 * CSRF defence in depth. Session cookies are SameSite=Lax, which already blocks cross-site POSTs
 * in modern browsers; this additionally rejects state-changing requests whose Origin header names
 * a different host. Bodies are only parsed as JSON, which a plain cross-site HTML form can't send.
 */
function sameOriginMutations(req: Request, _res: Response, next: NextFunction): void {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const origin = req.headers.origin;
    if (origin) {
      let host: string | null = null;
      try {
        host = new URL(origin).host;
      } catch {
        /* handled below */
      }
      if (host !== req.headers.host) throw new HttpError(403, 'Cross-origin request blocked');
    }
  }
  next();
}

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    const issue = err.issues[0];
    const field = issue?.path.join('.');
    res.status(400).json({
      error: `${field ? `${field}: ` : ''}${issue?.message ?? 'Invalid request'}`,
      issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (typeof err === 'object' && err !== null && 'type' in err && (err as { type?: string }).type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Request body is not valid JSON' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
};

export function createApp(ctx: AppContext): express.Express {
  const app = express();
  app.disable('x-powered-by');
  if (ctx.config.trustProxy > 0) app.set('trust proxy', ctx.config.trustProxy);

  app.use(securityHeaders);
  app.use(express.json({ limit: '10kb' }));
  app.use(sameOriginMutations);

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', time: Date.now() });
  });
  // Lets the web app adapt its UI (e.g. hide sign-up and edit controls) in the public demo.
  app.get('/api/config', (_req, res) => {
    res.json({ demoMode: ctx.config.demoMode });
  });
  app.use('/api/auth', authRouter(ctx));
  app.use('/api/monitors', monitorsRouter(ctx));
  app.use('/api/events', eventsRouter(ctx));
  app.use('/api/public', publicRouter(ctx));
  app.use('/api', (_req, _res) => {
    throw new HttpError(404, 'Not found');
  });

  const staticDir = ctx.config.staticDir;
  if (staticDir && existsSync(path.join(staticDir, 'index.html'))) {
    app.use(express.static(staticDir, { index: false, maxAge: '1h' }));
    // Single-page app: any other GET falls back to index.html so client-side routes work.
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
