/**
 * Demo mode: starts a throwaway app with a local "flaky" target server, a demo account and
 * 36 hours of synthetic check history, so every screen has something to show.
 *
 *   npm run demo        then sign in as demo@heartbeat.dev / demo-password-123
 *   public status page: /status/demo
 *
 * The seeded history is generated data (clearly labelled in the README). Everything after the
 * server starts is real: the scheduler genuinely checks the local target server below.
 */
import { rmSync } from 'node:fs';
import http from 'node:http';
import { createApp } from './app.js';
import { hashPassword } from './auth.js';
import { loadConfig } from './config.js';
import { recordCheck } from './checks.js';
import { openDb, run } from './db.js';
import { EventHub } from './events.js';
import { Scheduler } from './scheduler.js';

const TARGET_PORT = 4100;
const DB_FILE = './data/demo.db';
const EMAIL = 'demo@heartbeat.dev';
const PASSWORD = 'demo-password-123';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// --- A local target with different personalities --------------------------------------------

function startTargets(): http.Server {
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
  return server.listen(TARGET_PORT, '127.0.0.1');
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

async function main(): Promise<void> {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_FILE}${suffix}`, { force: true });

  const config = { ...loadConfig(), dbPath: DB_FILE, allowPrivateTargets: true, minIntervalSec: 5 };
  const db = openDb(DB_FILE);
  const hub = new EventHub();
  const targets = startTargets();

  const user = run(
    db,
    'INSERT INTO users (email, password_hash, slug, created_at) VALUES (?, ?, ?, ?)',
    EMAIL,
    await hashPassword(PASSWORD),
    'demo',
    Date.now(),
  );

  const now = Date.now();
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
      `http://127.0.0.1:${TARGET_PORT}${seed.path}`,
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

  const scheduler = new Scheduler(db, config, hub);
  const port = config.port;
  const server = createApp({ db, config, hub }).listen(port, () => {
    console.log(`\nHeartbeat demo running at http://localhost:${port}`);
    console.log(`  sign in:        ${EMAIL} / ${PASSWORD}`);
    console.log(`  status page:    http://localhost:${port}/status/demo`);
    console.log('  (history older than a few minutes is generated demo data; new checks are real)\n');
    scheduler.start();
  });

  const stop = () => {
    scheduler.stop();
    targets.closeAllConnections();
    targets.close();
    server.closeAllConnections();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2_000).unref();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

void main();
