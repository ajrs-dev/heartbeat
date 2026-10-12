/**
 * Local demo: starts a throwaway app with the built-in flaky targets and a seeded demo account.
 *
 *   npm run demo        then sign in as demo@heartbeat.dev / demo-password-123
 *   public status page: /status/demo
 *
 * (The hosted public demo is different: it runs the normal server with DEMO_MODE=true, which is
 * read-only and keeps the SSRF guard on. See README.)
 */
import { rmSync } from 'node:fs';
import { createApp } from './app.js';
import { hashPassword } from './auth.js';
import { loadConfig } from './config.js';
import { DEMO_EMAIL, seedDemoData, startDemoTargets } from './demoData.js';
import { openDb } from './db.js';
import { EventHub } from './events.js';
import { Scheduler } from './scheduler.js';

const DB_FILE = './data/demo.db';
const PASSWORD = 'demo-password-123';

async function main(): Promise<void> {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_FILE}${suffix}`, { force: true });

  const config = { ...loadConfig(), dbPath: DB_FILE, allowPrivateTargets: true, minIntervalSec: 5 };
  const db = openDb(DB_FILE);
  const hub = new EventHub();
  const targets = startDemoTargets();
  seedDemoData(db, await hashPassword(PASSWORD));

  const scheduler = new Scheduler(db, config, hub);
  const port = config.port;
  const server = createApp({ db, config, hub }).listen(port, () => {
    console.log(`\nHeartbeat demo running at http://localhost:${port}`);
    console.log(`  sign in:        ${DEMO_EMAIL} / ${PASSWORD}`);
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
