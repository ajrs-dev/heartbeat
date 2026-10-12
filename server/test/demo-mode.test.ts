import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCheck } from '../src/checker.js';
import { loadConfig } from '../src/config.js';
import { get, run } from '../src/db.js';
import { DEMO_EMAIL, seedDemoData } from '../src/demoData.js';
import { Scheduler } from '../src/scheduler.js';
import { HttpError } from '../src/errors.js';
import { parseTargetUrl } from '../src/ssrf.js';
import { makeContext } from './helpers.js';

let target: http.Server;
let port: number;
let hits = 0;

beforeAll(async () => {
  target = http.createServer((_req, res) => {
    hits++;
    res.writeHead(200).end('ok');
  });
  await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
  port = (target.address() as AddressInfo).port;
});

afterAll(() => {
  target.closeAllConnections();
  target.close();
});

describe('allowedTargets (exact host:port allowlist)', () => {
  const allowed = ['127.0.0.1:4100'];

  it('permits only the exact listed host and port', () => {
    expect(parseTargetUrl('http://127.0.0.1:4100/site', false, allowed).port).toBe('4100');
    for (const url of [
      'http://127.0.0.1:4101/site', // same host, different port
      'http://127.0.0.1/', // same host, no port
      'http://localhost:4100/', // same port, different name
      'http://10.0.0.1:4100/',
      'http://169.254.169.254/',
      'http://[::1]:4100/',
    ]) {
      expect(() => parseTargetUrl(url, false, allowed), url).toThrowError(HttpError);
    }
  });

  it('still rejects bad schemes and embedded credentials on an allowed host', () => {
    expect(() => parseTargetUrl('ftp://127.0.0.1:4100/', false, allowed)).toThrowError(/http/);
    expect(() => parseTargetUrl('http://user:pw@127.0.0.1:4100/', false, allowed)).toThrowError(/credentials/);
  });

  it('is empty by default, so nothing private is reachable without opting in', () => {
    expect(() => parseTargetUrl('http://127.0.0.1:4100/', false)).toThrowError(/private/);
  });

  it('lets the real checker reach an allowed target, and only that one', async () => {
    const allow = [`127.0.0.1:${port}`];
    hits = 0;
    expect(await runCheck(`http://127.0.0.1:${port}/`, 2000, false, allow)).toMatchObject({ ok: true, statusCode: 200 });
    expect(hits).toBe(1);

    const other = await runCheck(`http://127.0.0.1:${port + 1}/`, 2000, false, allow);
    expect(other).toMatchObject({ ok: false, statusCode: null });
    expect(other.error).toMatch(/private or internal/);
  });

  it('is honoured by the scheduler through config', async () => {
    const ctx = makeContext({ allowedTargets: [`127.0.0.1:${port}`] });
    const user = run(ctx.db, 'INSERT INTO users (email, password_hash, slug, created_at) VALUES (?, ?, ?, ?)', 'a@example.com', 'x', 's', 0);
    const add = (url: string) =>
      run(ctx.db, 'INSERT INTO monitors (user_id, name, url, interval_sec, timeout_ms, created_at) VALUES (?, ?, ?, 60, 5000, 0)', user.id, 'm', url).id;
    const allowedId = add(`http://127.0.0.1:${port}/`);
    const blockedId = add('http://127.0.0.1:1/');

    await new Scheduler(ctx.db, ctx.config, ctx.hub).tick(1_000_000);

    const status = (id: number) => get<{ last_ok: number; last_error: string | null }>(ctx.db, 'SELECT last_ok, last_error FROM monitors WHERE id = ?', id)!;
    expect(status(allowedId).last_ok).toBe(1);
    expect(status(blockedId).last_ok).toBe(0);
    expect(status(blockedId).last_error).toMatch(/private or internal/);
  });
});

describe('loadConfig', () => {
  it('turns on demo mode and the built-in allowlist only when DEMO_MODE=true', () => {
    expect(loadConfig({}).demoMode).toBe(false);
    expect(loadConfig({}).allowedTargets).toEqual([]);
    expect(loadConfig({ DEMO_MODE: 'yes' }).demoMode).toBe(false);
    const demo = loadConfig({ DEMO_MODE: 'true' });
    expect(demo.demoMode).toBe(true);
    expect(demo.allowedTargets).toEqual(['127.0.0.1:4100']);
    expect(demo.allowPrivateTargets).toBe(false); // demo mode never turns private targets fully on
  });
});

describe('public demo mode', () => {
  function demoApp() {
    const ctx = makeContext({ demoMode: true, allowedTargets: ['127.0.0.1:4100'] });
    seedDemoData(ctx.db, 'unusable-hash');
    return ctx;
  }

  it('reports demo mode to the web app', async () => {
    expect((await request(demoApp().app).get('/api/config')).body).toEqual({ demoMode: true });
    expect((await request(makeContext().app).get('/api/config')).body).toEqual({ demoMode: false });
  });

  it('disables sign-ups', async () => {
    const res = await request(demoApp().app).post('/api/auth/register').send({ email: 'new@example.com', password: 'correct horse battery' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/disabled in the public demo/);
  });

  it('signs visitors into the seeded demo account with one request', async () => {
    const { app } = demoApp();
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/demo');
    expect(login.status).toBe(200);
    expect(login.body.user).toMatchObject({ email: DEMO_EMAIL, slug: 'demo' });
    expect(String(login.headers['set-cookie'])).toMatch(/HttpOnly/i);

    const overview = await agent.get('/api/monitors/overview');
    expect(overview.status).toBe(200);
    expect(overview.body.monitors).toHaveLength(5);
    expect(overview.body.monitors[0].buckets).toHaveLength(48);
  });

  it('cannot be signed into with a password (nobody knows it)', async () => {
    const res = await request(demoApp().app).post('/api/auth/login').send({ email: DEMO_EMAIL, password: 'demo-password-123' });
    expect(res.status).toBe(401);
  });

  it('is read-only: creating, changing and deleting monitors are refused', async () => {
    const { app, db } = demoApp();
    const agent = request.agent(app);
    await agent.post('/api/auth/demo');
    const before = get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM monitors')!.n;
    const id = get<{ id: number }>(db, 'SELECT id FROM monitors LIMIT 1')!.id;

    for (const res of [
      await agent.post('/api/monitors').send({ name: 'x', url: 'https://example.com' }),
      await agent.patch(`/api/monitors/${id}`).send({ name: 'hacked' }),
      await agent.patch(`/api/monitors/${id}`).send({ isPaused: true }),
      await agent.delete(`/api/monitors/${id}`),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('The public demo is read-only');
    }
    expect(get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM monitors')!.n).toBe(before);
    expect(get<{ name: string }>(db, 'SELECT name FROM monitors WHERE id = ?', id)!.name).not.toBe('hacked');
  });

  it('still serves the public status page and lets visitors sign out', async () => {
    const { app } = demoApp();
    const agent = request.agent(app);
    await agent.post('/api/auth/demo');
    const page = await request(app).get('/api/public/demo');
    expect(page.status).toBe(200);
    expect(page.body.monitors.map((m: { name: string }) => m.name)).not.toContain('Internal admin (private)');
    expect((await agent.post('/api/auth/logout')).status).toBe(204);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('rate-limits the demo login endpoint too', async () => {
    const ctx = makeContext({ demoMode: true, authRateLimit: { max: 2, windowMs: 60_000 } });
    seedDemoData(ctx.db, 'x');
    for (let i = 0; i < 2; i++) expect((await request(ctx.app).post('/api/auth/demo')).status).toBe(200);
    expect((await request(ctx.app).post('/api/auth/demo')).status).toBe(429);
  });
});

describe('normal (non-demo) deployments', () => {
  it('have no demo login at all', async () => {
    const { app } = makeContext();
    expect((await request(app).post('/api/auth/demo')).status).toBe(404);
  });

  it('still allow registration and monitor changes', async () => {
    const { app } = makeContext();
    const agent = request.agent(app);
    expect((await agent.post('/api/auth/register').send({ email: 'a@example.com', password: 'correct horse battery' })).status).toBe(201);
    expect((await agent.post('/api/monitors').send({ name: 'x', url: 'https://example.com' })).status).toBe(201);
  });
});
