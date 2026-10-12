/**
 * Everything the demos share: a local "flaky" target server with different personalities, and a
 * seeded account with 36 hours of generated check history so every screen has something to show.
 *
 * Used by `npm run demo` (local) and by DEMO_MODE (the hosted public demo). The seeded history is
 * generated data; checks that happen after the server starts are real requests to the local targets.
 */
import http from 'node:http';
import { recordCheck } from './checks.js';
import { run, type DB } from './db.js';

export const DEMO_EMAIL = 'demo@heartbeat.dev';
export const DEMO_SLUG = 'demo';
export const DEMO_TARGET_PORT = 4100;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// --- A local target with different personalities --------------------------------------------

export function startDemoTargets(port = DEMO_TARGET_PORT): http.Server {
  const jitter = (min: number, max: number) => min + Math.random() * (max - min);
  const respond = (res: http.ServerResponse, status: number, delay: number) =>
    setTimeout(() => res.writeHead(status, { 'content-type': 'text/plain' }).end(status < 400 ? 'ok' : 'error'), delay);

  const server = http.createServer((req, res) => {
    switch (req.url) {
      case '/site':
        return void respond(res, 200, jitter(15, 60));
      case '/api':
        return void respond(res, 200, jitter(40, 140));
      case '/payments':
        return void respond(res, 200, jitter(120, 520));
      case '/checkout': {
        // Fails for 45 seconds out of every three minutes, so incidents open and resolve live.
        const failing = Math.floor(Date.now() / 45_000) % 4 === 3;
        return void respond(res, failing ? 503 : 200, jitter(30, 110));
      }
      default:
        return void respond(res, 404, 5);
    }
  });
  // Loopback only: the targets must never be reachable from outside the machine.
  return server.listen(port, '127.0.0.1');
}

// --- Deterministic synthetic history --------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Seed {
  name: string;
  path: string;
  isPublic: boolean;
  baseLatency: number;
  spread: number;
  /** Outages as [how long ago it started, how long it lasted], in milliseconds. */
  outages: Array<[number, number]>;
}

const SEEDS: Seed[] = [
  { name: 'Marketing site', path: '/site', isPublic: true, baseLatency: 35, spread: 25, outages: [] },
  { name: 'Public API', path: '/api', isPublic: true, baseLatency: 80, spread: 60, outages: [[19 * HOUR, 7 * MINUTE]] },
  { name: 'Payments gateway', path: '/payments', isPublic: true, baseLatency: 260, spread: 220, outages: [] },
  { name: 'Checkout service', path: '/checkout', isPublic: true, baseLatency: 60, spread: 50, outages: [[26 * HOUR, 14 * MINUTE], [8 * HOUR, 5 * MINUTE]] },
  { name: 'Internal admin (private)', path: '/api', isPublic: false, baseLatency: 90, spread: 40, outages: [] },
];

/** Creates the demo account and its monitors, back-filled with 36 hours of generated history. */
export function seedDemoData(db: DB, passwordHash: string, now = Date.now(), targetPort = DEMO_TARGET_PORT): number {
  const user = run(
    db,
    'INSERT INTO users (email, password_hash, slug, created_at) VALUES (?, ?, ?, ?)',
    DEMO_EMAIL,
    passwordHash,
    DEMO_SLUG,
    now,
  );

  const rand = mulberry32(42);
  const intervalSec = 20;
  const HISTORY = 36 * HOUR;

  for (const seed of SEEDS) {
    const { id } = run(
      db,
      `INSERT INTO monitors (user_id, name, url, interval_sec, timeout_ms, is_public, created_at)
       VALUES (?, ?, ?, ?, 8000, ?, ?)`,
      user.id,
      seed.name,
      `http://127.0.0.1:${targetPort}${seed.path}`,
      intervalSec,
      seed.isPublic ? 1 : 0,
      now - HISTORY,
    );

    // One synthetic check per minute keeps the seed quick while still filling every chart.
    for (let t = now - HISTORY; t < now - 2 * MINUTE; t += MINUTE) {
      const outage = seed.outages.some(([ago, length]) => t >= now - ago && t < now - ago + length);
      const timedOut = !outage && rand() < 0.002;
      const result = outage
        ? { ok: false, statusCode: 503, latencyMs: Math.round(20 + rand() * 40), error: 'HTTP 503' }
        : timedOut
          ? { ok: false, statusCode: null, latencyMs: null, error: 'Timed out after 8000 ms' }
          : {
              ok: true,
              statusCode: 200,
              latencyMs: Math.round(seed.baseLatency + rand() * seed.spread + (rand() < 0.03 ? seed.spread * 3 : 0)),
              error: null,
            };
      recordCheck(db, { id }, result, t);
    }
  }
  return user.id;
}
