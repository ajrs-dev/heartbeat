import { randomBytes } from 'node:crypto';
import { createApp } from './app.js';
import { hashPassword } from './auth.js';
import { loadConfig } from './config.js';
import { get, openDb } from './db.js';
import { seedDemoData, startDemoTargets } from './demoData.js';
import { EventHub } from './events.js';
import { Scheduler } from './scheduler.js';

const config = loadConfig();
const db = openDb(config.dbPath);
const hub = new EventHub();
const scheduler = new Scheduler(db, config, hub);

if (config.demoMode) {
  // Public demo: seed once, with a password nobody knows (visitors use the demo login button).
  startDemoTargets();
  if (!get(db, 'SELECT 1 AS x FROM users LIMIT 1')) {
    seedDemoData(db, await hashPassword(randomBytes(24).toString('hex')));
  }
  console.log('DEMO_MODE is on: sign-ups and changes are disabled, only the built-in demo targets can be monitored.');
}

const server = createApp({ db, config, hub }).listen(config.port, () => {
  console.log(`Heartbeat listening on http://localhost:${config.port}`);
  if (config.allowPrivateTargets) console.warn('ALLOW_PRIVATE_TARGETS is on: monitors may target private addresses.');
  scheduler.start();
});

function shutdown(signal: string): void {
  console.log(`${signal} received, shutting down`);
  scheduler.stop();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  // Long-lived SSE connections would keep close() waiting forever.
  setTimeout(() => process.exit(0), 5_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
