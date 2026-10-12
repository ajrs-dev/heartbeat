import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { EventHub } from './events.js';
import { Scheduler } from './scheduler.js';

const config = loadConfig();
const db = openDb(config.dbPath);
const hub = new EventHub();
const scheduler = new Scheduler(db, config, hub);

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
