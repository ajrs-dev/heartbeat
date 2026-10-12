import request from 'supertest';
import { createApp } from '../src/app.js';
import { defaultConfig, type Config } from '../src/config.js';
import { openDb } from '../src/db.js';
import { EventHub } from '../src/events.js';

export function makeContext(overrides: Partial<Config> = {}) {
  const config: Config = {
    ...defaultConfig(),
    dbPath: ':memory:',
    allowPrivateTargets: false,
    authRateLimit: { max: 1000, windowMs: 60_000 },
    ...overrides,
  };
  const db = openDb(':memory:');
  const hub = new EventHub();
  const app = createApp({ db, config, hub });
  return { config, db, hub, app };
}

/** A supertest agent that is already registered and signed in (it keeps the session cookie). */
export async function signedInAgent(app: ReturnType<typeof makeContext>['app'], email = 'user@example.com') {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/register').send({ email, password: 'correct horse battery' });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  const cookie = String(([] as string[]).concat(res.headers['set-cookie'] ?? [])[0] ?? '').split(';')[0]!;
  return { agent, cookie, user: res.body.user as { id: number; email: string; slug: string } };
}
