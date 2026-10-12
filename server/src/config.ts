import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Config {
  port: number;
  dbPath: string;
  production: boolean;
  /** Number of reverse proxies in front of the app (used for client IPs behind a proxy). */
  trustProxy: number;
  /** Lets monitors target private / loopback addresses. Off in production; on for tests and the demo. */
  allowPrivateTargets: boolean;
  sessionTtlMs: number;
  authRateLimit: { max: number; windowMs: number };
  retentionDays: number;
  minIntervalSec: number;
  maxMonitorsPerUser: number;
  schedulerTickMs: number;
  maxConcurrentChecks: number;
  /** Directory containing the built web app, or null to serve the API only. */
  staticDir: string | null;
}

export function defaultConfig(): Config {
  return {
    port: 3001,
    dbPath: './data/heartbeat.db',
    production: false,
    trustProxy: 0,
    allowPrivateTargets: false,
    sessionTtlMs: 14 * 24 * 60 * 60 * 1000,
    authRateLimit: { max: 10, windowMs: 60_000 },
    retentionDays: 30,
    minIntervalSec: 30,
    maxMonitorsPerUser: 25,
    schedulerTickMs: 1000,
    maxConcurrentChecks: 10,
    staticDir: null,
  };
}

function int(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const base = defaultConfig();
  const here = path.dirname(fileURLToPath(import.meta.url));
  const builtWeb = path.resolve(here, '../../web/dist');
  return {
    ...base,
    port: int(env.PORT, base.port),
    dbPath: env.DB_PATH ?? base.dbPath,
    production: env.NODE_ENV === 'production',
    trustProxy: int(env.TRUST_PROXY, base.trustProxy),
    allowPrivateTargets: env.ALLOW_PRIVATE_TARGETS === 'true',
    retentionDays: int(env.RETENTION_DAYS, base.retentionDays),
    minIntervalSec: int(env.MIN_INTERVAL_SEC, base.minIntervalSec),
    staticDir: existsSync(builtWeb) ? builtWeb : null,
  };
}
