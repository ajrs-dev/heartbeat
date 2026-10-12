import type { NextFunction, Request, Response } from 'express';
import { HttpError } from './errors.js';

/**
 * Fixed-window rate limiter keyed by client IP. In-memory, which is the right trade-off for a
 * single-process deployment; running several instances would need a shared store such as Redis.
 */
export function createRateLimiter(options: { max: number; windowMs: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    if (hits.size > 10_000) {
      for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
    }

    const key = req.ip ?? 'unknown';
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + options.windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;

    if (entry.count > options.max) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
      throw new HttpError(429, 'Too many attempts. Please wait a moment and try again.');
    }
    next();
  };
}
