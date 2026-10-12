import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCheck, type CheckResult } from '../src/checker.js';
import { recordCheck } from '../src/checks.js';
import { run } from '../src/db.js';
import { EventHub, type CheckEvent } from '../src/events.js';
import { Scheduler } from '../src/scheduler.js';
import { makeContext } from './helpers.js';

let server: http.Server;
let base: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/ok') return void res.writeHead(200).end('fine');
    if (req.url === '/redirect-internal') return void res.writeHead(302, { location: 'http://169.254.169.254/' }).end();
    if (req.url === '/redirect') return void res.writeHead(301, { location: '/ok' }).end();
    if (req.url === '/boom') return void res.writeHead(503).end('down');
    if (req.url === '/slow') return void setTimeout(() => res.writeHead(200).end('late'), 1500);
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

describe('runCheck', () => {
  it('reports success with a latency for a 200', async () => {
    const result = await runCheck(`${base}/ok`, 2000, true);
    expect(result).toMatchObject({ ok: true, statusCode: 200, error: null });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('treats 5xx as down but still records the latency', async () => {
    const result = await runCheck(`${base}/boom`, 2000, true);
    expect(result).toMatchObject({ ok: false, statusCode: 503, error: 'HTTP 503' });
    expect(result.latencyMs).not.toBeNull();
  });

  it('does not follow redirects; a 3xx counts as up and never reaches the target', async () => {
    expect(await runCheck(`${base}/redirect`, 2000, true)).toMatchObject({ ok: true, statusCode: 301 });
    // Following this would hit the cloud-metadata address. We simply report the 302.
    expect(await runCheck(`${base}/redirect-internal`, 2000, true)).toMatchObject({ ok: true, statusCode: 302 });
  });

  it('times out slow responses', async () => {
    const result = await runCheck(`${base}/slow`, 300, true);
    expect(result).toMatchObject({ ok: false, statusCode: null, latencyMs: null });
    expect(result.error).toMatch(/Timed out after 300 ms/);
  });

  it('reports connection failures clearly', async () => {
    const closed = http.createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise((resolve) => closed.close(resolve));
    expect((await runCheck(`http://127.0.0.1:${port}/`, 2000, true)).error).toBe('Connection refused');
  });

  it('refuses internal targets unless private targets are allowed (SSRF guard at check time)', async () => {
    for (const url of [`${base}/ok`, 'http://localhost/', 'http://169.254.169.254/']) {
      const result = await runCheck(url, 2000, false);
      expect(result.ok, url).toBe(false);
      expect(result.statusCode, url).toBeNull();
      expect(result.error, url).toMatch(/private or internal/);
    }
  });
});

describe('Scheduler', () => {
  function setup(check: (url: string) => Promise<CheckResult>, hub = new EventHub()) {
    const ctx = makeContext({ maxConcurrentChecks: 2 });
    const user = run(ctx.db, 'INSERT INTO users (email, password_hash, slug, created_at) VALUES (?, ?, ?, ?)', 'a@example.com', 'x', 's', 0);
    const add = (name: string, intervalSec = 60, paused = 0) =>
      run(
        ctx.db,
        'INSERT INTO monitors (user_id, name, url, interval_sec, timeout_ms, is_paused, created_at) VALUES (?, ?, ?, ?, 5000, ?, 0)',
        user.id,
        name,
        `https://${name}.example.com`,
        intervalSec,
        paused,
      ).id;
    const scheduler = new Scheduler(ctx.db, ctx.config, hub, (url) => check(url));
    return { ...ctx, user, add, scheduler };
  }

  const okResult: CheckResult = { ok: true, statusCode: 200, latencyMs: 12, error: null };
  const checkCount = (db: ReturnType<typeof makeContext>['db'], id: number) =>
    (db.prepare('SELECT COUNT(*) AS n FROM checks WHERE monitor_id = ?').get(id) as { n: number }).n;

  it('runs new monitors immediately, then only when their interval has elapsed', async () => {
    const { scheduler, db, add } = setup(async () => okResult);
    const id = add('a', 60);

    await scheduler.tick(1_000_000);
    expect(checkCount(db, id)).toBe(1);
    await scheduler.tick(1_000_000 + 30_000); // not due yet
    expect(checkCount(db, id)).toBe(1);
    await scheduler.tick(1_000_000 + 60_000); // due
    expect(checkCount(db, id)).toBe(2);
  });

  it('skips paused monitors', async () => {
    const { scheduler, db, add } = setup(async () => okResult);
    const id = add('paused', 60, 1);
    await scheduler.tick(5_000_000);
    expect(checkCount(db, id)).toBe(0);
  });

  it('respects the concurrency limit', async () => {
    let running = 0;
    let peak = 0;
    const { scheduler, add } = setup(async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 20));
      running--;
      return okResult;
    });
    for (const name of ['a', 'b', 'c', 'd', 'e']) add(name);
    await scheduler.tick(1_000_000);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("never starts a second check for a monitor that is still being checked", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { scheduler, add } = setup(async () => {
      calls++;
      await gate;
      return okResult;
    });
    add('slow', 30);
    const first = scheduler.tick(1_000_000);
    await scheduler.tick(1_000_000 + 60_000); // overdue, but the first check is still running
    release();
    await first;
    expect(calls).toBe(1);
  });

  it('publishes live events to the owning user only', async () => {
    const hub = new EventHub();
    const { scheduler, add, user } = setup(async () => ({ ok: false, statusCode: 500, latencyMs: 40, error: 'HTTP 500' }), hub);
    const mine: CheckEvent[] = [];
    const others: CheckEvent[] = [];
    hub.subscribe(user.id, (e) => mine.push(e));
    hub.subscribe(user.id + 1, (e) => others.push(e));
    const id = add('a');
    await scheduler.tick(1_000_000);
    expect(mine).toEqual([{ type: 'check', monitorId: id, ok: false, status: 'down', latencyMs: 40, checkedAt: 1_000_000 }]);
    expect(others).toEqual([]);
  });

  it('survives a monitor being deleted while its check is in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { scheduler, db, add } = setup(async () => {
      await gate;
      return okResult;
    });
    const id = add('doomed');
    const pending = scheduler.tick(1_000_000);
    run(db, 'DELETE FROM monitors WHERE id = ?', id);
    release();
    await expect(pending).resolves.toBeUndefined();
    expect(() => recordCheck(db, { id }, okResult, 1)).toThrow(); // the FK really does reject orphans
  });
});
