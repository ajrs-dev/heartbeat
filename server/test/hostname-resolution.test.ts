/**
 * End-to-end tests for the connect-time hostname check.
 *
 * `parseTargetUrl` can only look at the *text* of a URL, so a perfectly ordinary-looking hostname
 * (app.example.test) that resolves to 127.0.0.1 gets past it. These tests stub DNS to produce
 * exactly that situation and verify that the real request path (http.request + scheduler) refuses
 * to connect, and that the target server is never contacted.
 */
import dns from 'node:dns';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCheck } from '../src/checker.js';
import { all, get } from '../src/db.js';
import { parseTargetUrl } from '../src/ssrf.js';
import { Scheduler } from '../src/scheduler.js';
import { makeContext, signedInAgent } from './helpers.js';

type Answer = { address: string; family: 4 | 6 };
const v4 = (address: string): Answer => ({ address, family: 4 });
const v6 = (address: string): Answer => ({ address, family: 6 });

const realLookup = dns.lookup.bind(dns) as (...args: unknown[]) => void;

/**
 * Replaces DNS resolution for *.example.test names only (everything else, such as supertest
 * resolving localhost, goes to the real resolver). The resolver may return answers or an Error.
 */
function stubDns(resolve: (hostname: string) => Answer[] | Error) {
  return vi.spyOn(dns, 'lookup').mockImplementation(((hostname: string, options: unknown, callback: (...args: unknown[]) => void) => {
    if (!hostname.endsWith('.example.test')) return realLookup(hostname, options, callback);
    const result = resolve(hostname);
    if (result instanceof Error) callback(result);
    else callback(null, result);
  }) as never);
}

let server: http.Server;
let port: number;
let hits = 0;

beforeAll(async () => {
  server = http.createServer((_req, res) => {
    hits++;
    res.writeHead(200).end('internal secret');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

beforeEach(() => {
  hits = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

const url = (host = 'app.example.test') => `http://${host}:${port}/`;

describe('connect-time hostname check (production settings: private targets not allowed)', () => {
  it('refuses a normal-looking hostname that resolves to loopback, without contacting the server', async () => {
    stubDns(() => [v4('127.0.0.1')]);
    // The text of the URL is fine; only resolution reveals the problem.
    expect(() => parseTargetUrl(url(), false)).not.toThrow();

    const result = await runCheck(url(), 2000, false);

    expect(result).toMatchObject({ ok: false, statusCode: null, latencyMs: null });
    expect(result.error).toBe('app.example.test resolves to a private or internal address');
    expect(hits).toBe(0);
  });

  it.each([
    ['10.0.0.5', v4],
    ['172.16.4.2', v4],
    ['192.168.1.10', v4],
    ['169.254.169.254', v4], // cloud metadata
    ['100.64.0.1', v4],
    ['::1', v6],
    ['fe80::1', v6],
    ['fd00::1234', v6],
    ['::ffff:127.0.0.1', v6], // IPv4-mapped loopback
    ['::ffff:7f00:1', v6],
  ])('refuses a hostname that resolves to %s', async (address, make) => {
    stubDns(() => [make(address)]);
    const result = await runCheck(url(), 2000, false);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/private or internal address/);
    expect(hits).toBe(0);
  });

  it('refuses when ANY returned address is private, even if others are public', async () => {
    stubDns(() => [v4('93.184.216.34'), v4('127.0.0.1')]);
    const result = await runCheck(url(), 2000, false);
    expect(result.error).toMatch(/private or internal address/);
    expect(hits).toBe(0);
  });

  it('reports DNS failures plainly', async () => {
    stubDns(() => Object.assign(new Error('getaddrinfo ENOTFOUND nope.example.test'), { code: 'ENOTFOUND' }));
    expect((await runCheck(url('nope.example.test'), 2000, false)).error).toBe('DNS lookup failed');
  });

  it('asks DNS about the hostname in the URL, not about anything else', async () => {
    const spy = stubDns(() => [v4('127.0.0.1')]);
    await runCheck(url('billing.example.test'), 2000, false);
    expect(spy.mock.calls.map((c) => c[0])).toEqual(['billing.example.test']);
  });
});

describe('the same hostname when private targets ARE allowed (development / demo)', () => {
  it('connects, proving the guarded lookup is genuinely what the request uses', async () => {
    const spy = stubDns(() => [v4('127.0.0.1')]);
    const result = await runCheck(url(), 2000, true);
    expect(result).toMatchObject({ ok: true, statusCode: 200 });
    expect(hits).toBe(1);
    expect(spy).toHaveBeenCalled();
  });
});

describe('DNS rebinding through the whole stack', () => {
  it('accepts a monitor while its name is public, then blocks the check once the name points inside', async () => {
    const { app, db, config, hub } = makeContext({ allowPrivateTargets: false });
    const { agent } = await signedInAgent(app);

    // Phase 1: the attacker's domain resolves to a public address. Creating the monitor succeeds.
    let phase: 'public' | 'rebound' = 'public';
    stubDns(() => (phase === 'public' ? [v4('93.184.216.34')] : [v4('127.0.0.1')]));
    const created = await agent.post('/api/monitors').send({ name: 'Looks harmless', url: url('rebind.example.test') });
    expect(created.status).toBe(201);

    // Phase 2: the DNS answer flips to loopback. The scheduler runs the real checker.
    phase = 'rebound';
    await new Scheduler(db, config, hub).tick(Date.now());

    const check = get<{ ok: number; error: string }>(db, 'SELECT ok, error FROM checks WHERE monitor_id = ?', created.body.monitor.id)!;
    expect(check.ok).toBe(0);
    expect(check.error).toMatch(/private or internal address/);
    expect(hits).toBe(0);

    const row = get<{ last_ok: number; last_error: string }>(db, 'SELECT last_ok, last_error FROM monitors WHERE id = ?', created.body.monitor.id)!;
    expect(row.last_ok).toBe(0);
    expect(row.last_error).toMatch(/private or internal address/);
  });

  it('keeps blocking on every later check and opens an incident', async () => {
    const { app, db, config, hub } = makeContext({ allowPrivateTargets: false });
    const { agent } = await signedInAgent(app);
    stubDns(() => [v4('93.184.216.34')]);
    const created = await agent.post('/api/monitors').send({ name: 'm', url: url('rebind.example.test'), intervalSec: 30 });
    stubDns(() => [v4('169.254.169.254')]);

    const scheduler = new Scheduler(db, config, hub);
    const start = Date.now();
    await scheduler.tick(start);
    await scheduler.tick(start + 31_000);

    const checks = all<{ ok: number }>(db, 'SELECT ok FROM checks WHERE monitor_id = ?', created.body.monitor.id);
    expect(checks.map((c) => c.ok)).toEqual([0, 0]);
    expect(all(db, 'SELECT * FROM incidents WHERE monitor_id = ?', created.body.monitor.id)).toHaveLength(1);
    expect(hits).toBe(0);
    // And the API reports the monitor as down, with the reason, rather than hiding it.
    const monitor = await agent.get('/api/monitors/' + created.body.monitor.id);
    expect(monitor.body.monitor.status).toBe('down');
    expect(monitor.body.monitor.lastError).toMatch(/private or internal address/);
  });
});
