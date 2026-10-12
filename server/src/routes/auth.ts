import { randomBytes } from 'node:crypto';
import { Router, type Response } from 'express';
import { z } from 'zod';
import {
  SESSION_COOKIE,
  createSession,
  destroySession,
  hashPassword,
  requireAuth,
  sessionToken,
  verifyPassword,
} from '../auth.js';
import type { AppContext } from '../context.js';
import { get, run } from '../db.js';
import { DEMO_SLUG } from '../demoData.js';
import { HttpError } from '../errors.js';
import { createRateLimiter } from '../rateLimit.js';

const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);

const registerSchema = z.object({
  email,
  password: z.string().min(10, 'Password must be at least 10 characters').max(200),
});
const loginSchema = z.object({ email, password: z.string().min(1).max(200) });

interface UserRow {
  id: number;
  email: string;
  slug: string;
  password_hash: string;
}

export function authRouter(ctx: AppContext): Router {
  const router = Router();
  const limiter = createRateLimiter(ctx.config.authRateLimit);

  function startSession(res: Response, userId: number): void {
    const token = createSession(ctx.db, userId, ctx.config.sessionTtlMs);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: ctx.config.production,
      maxAge: ctx.config.sessionTtlMs,
      path: '/',
    });
  }

  router.post('/register', limiter, async (req, res) => {
    if (ctx.config.demoMode) throw new HttpError(403, 'Sign-ups are disabled in the public demo');
    const body = registerSchema.parse(req.body);
    if (get(ctx.db, 'SELECT 1 AS x FROM users WHERE email = ?', body.email)) {
      throw new HttpError(409, 'An account with that email already exists');
    }
    const slug = randomBytes(4).toString('hex');
    const { id } = run(
      ctx.db,
      'INSERT INTO users (email, password_hash, slug, created_at) VALUES (?, ?, ?, ?)',
      body.email,
      await hashPassword(body.password),
      slug,
      Date.now(),
    );
    startSession(res, id);
    res.status(201).json({ user: { id, email: body.email, slug } });
  });

  router.post('/login', limiter, async (req, res) => {
    const body = loginSchema.parse(req.body);
    const user = get<UserRow>(ctx.db, 'SELECT id, email, slug, password_hash FROM users WHERE email = ?', body.email);
    const valid = await verifyPassword(body.password, user?.password_hash ?? null);
    if (!user || !valid) throw new HttpError(401, 'Invalid email or password');
    startSession(res, user.id);
    res.json({ user: { id: user.id, email: user.email, slug: user.slug } });
  });

  /** One-click sign-in to the seeded demo account. Exists only when DEMO_MODE is on. */
  router.post('/demo', limiter, (_req, res) => {
    if (!ctx.config.demoMode) throw new HttpError(404, 'Not found');
    const user = get<{ id: number; email: string; slug: string }>(ctx.db, 'SELECT id, email, slug FROM users WHERE slug = ?', DEMO_SLUG);
    if (!user) throw new HttpError(503, 'The demo is still starting up. Try again in a moment.');
    startSession(res, user.id);
    res.json({ user });
  });

  router.post('/logout', (req, res) => {
    const token = sessionToken(req);
    if (token) destroySession(ctx.db, token);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.status(204).end();
  });

  router.get('/me', requireAuth(ctx.db), (req, res) => {
    res.json({ user: req.user });
  });

  return router;
}
