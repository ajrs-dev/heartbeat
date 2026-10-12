import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { get, run, type DB } from './db.js';
import { HttpError } from './errors.js';

export interface AuthUser {
  id: number;
  email: string;
  slug: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const SESSION_COOKIE = 'hb_session';

// scrypt parameters (N=2^15, r=8, p=1) follow the OWASP guidance for password storage.
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 } as const;

function scryptAsync(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** Produces `scrypt$N$r$p$salt$hash`, so parameters can be raised later without breaking old hashes. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT.keylen, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

let dummyHash: Promise<string> | undefined;

/**
 * Verifies a password. When there is no stored hash (unknown email) it still performs a full
 * scrypt computation against a dummy hash, so response time doesn't reveal which emails exist.
 */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const hash = stored ?? (await (dummyHash ??= hashPassword('not-a-real-password')));
  const [scheme, n, r, p, salt, expected] = hash.split('$');
  if (scheme !== 'scrypt' || !n || !r || !p || !salt || !expected) return false;
  const expectedKey = Buffer.from(expected, 'base64');
  const key = await scryptAsync(password, Buffer.from(salt, 'base64'), expectedKey.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return timingSafeEqual(key, expectedKey) && stored !== null;
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/** Creates a session and returns the raw token. Only its hash is persisted. */
export function createSession(db: DB, userId: number, ttlMs: number, now = Date.now()): string {
  const token = randomBytes(32).toString('base64url');
  run(db, 'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', sha256(token), userId, now + ttlMs);
  return token;
}

export function destroySession(db: DB, token: string): void {
  run(db, 'DELETE FROM sessions WHERE token_hash = ?', sha256(token));
}

export function userForSession(db: DB, token: string, now = Date.now()): AuthUser | undefined {
  return get<AuthUser>(
    db,
    `SELECT u.id, u.email, u.slug FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
    sha256(token),
    now,
  );
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    if (name && !(name in cookies)) cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

export function sessionToken(req: Request): string | undefined {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE];
}

export function requireAuth(db: DB) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const token = sessionToken(req);
    const user = token ? userForSession(db, token) : undefined;
    if (!user) throw new HttpError(401, 'Not signed in');
    req.user = user;
    next();
  };
}
