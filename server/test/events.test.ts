import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import type { CheckEvent } from '../src/events.js';
import { makeContext, signedInAgent } from './helpers.js';

const servers: http.Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    s.close();
  }
});

async function listen(app: ReturnType<typeof makeContext>['app']) {
  const server = http.createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

/** Opens the SSE endpoint and exposes the text received so far. */
function openStream(port: number, cookie?: string) {
  let received = '';
  let status = 0;
  let headers: http.IncomingHttpHeaders = {};
  const waiters: Array<() => void> = [];
  const req = http.get({ host: '127.0.0.1', port, path: '/api/events', headers: cookie ? { cookie } : {} }, (res) => {
    status = res.statusCode ?? 0;
    headers = res.headers;
    res.setEncoding('utf8');
    res.on('data', (chunk: string) => {
      received += chunk;
      waiters.splice(0).forEach((w) => w());
    });
  });
  req.on('error', () => undefined);
  return {
    get text() {
      return received;
    },
    get status() {
      return status;
    },
    get headers() {
      return headers;
    },
    close: () => req.destroy(),
    /** Resolves once the received text matches, or rejects after a timeout. */
    until: (pattern: RegExp, ms = 2000) =>
      new Promise<string>((resolve, reject) => {
        const check = () => pattern.test(received) && resolve(received);
        const timer = setTimeout(() => reject(new Error(`timed out waiting for ${pattern}; got ${JSON.stringify(received)}`)), ms);
        const poll = () => {
          if (pattern.test(received)) {
            clearTimeout(timer);
            return resolve(received);
          }
          waiters.push(poll);
        };
        check();
        poll();
      }),
  };
}

const event = (monitorId: number, overrides: Partial<CheckEvent> = {}): CheckEvent => ({
  type: 'check',
  monitorId,
  ok: true,
  status: 'up',
  latencyMs: 42,
  checkedAt: 1_700_000_000_000,
  ...overrides,
});

describe('GET /api/events (server-sent events)', () => {
  it('requires authentication', async () => {
    const { app } = makeContext();
    expect((await request(app).get('/api/events')).status).toBe(401);
  });

  it('streams check events to the signed-in user as they are published', async () => {
    const { app, hub } = makeContext();
    const { cookie, user } = await signedInAgent(app);
    const stream = openStream(await listen(app), cookie);

    await stream.until(/retry: 3000/);
    expect(stream.status).toBe(200);
    expect(stream.headers['content-type']).toBe('text/event-stream');
    expect(stream.headers['cache-control']).toContain('no-cache');

    hub.emit(user.id, event(7, { ok: false, status: 'down', latencyMs: null }));
    const text = await stream.until(/event: check\ndata: .*\n\n/);
    const data = JSON.parse(/data: (.*)\n/.exec(text)![1]!);
    expect(data).toMatchObject({ type: 'check', monitorId: 7, ok: false, status: 'down', latencyMs: null });
    stream.close();
  });

  it("never leaks one user's events to another user's stream", async () => {
    const { app, hub } = makeContext();
    const alice = await signedInAgent(app, 'alice@example.com');
    const bob = await signedInAgent(app, 'bob@example.com');
    const port = await listen(app);
    const bobStream = openStream(port, bob.cookie);
    const aliceStream = openStream(port, alice.cookie);
    await Promise.all([bobStream.until(/retry/), aliceStream.until(/retry/)]);

    hub.emit(alice.user.id, event(1));
    await aliceStream.until(/"monitorId":1/);
    // Give any (incorrect) delivery to Bob a moment to show up.
    await new Promise((r) => setTimeout(r, 100));
    expect(bobStream.text).not.toContain('monitorId');
    bobStream.close();
    aliceStream.close();
  });

  it('stops delivering and unsubscribes when the client disconnects', async () => {
    const { app, hub } = makeContext();
    const { cookie } = await signedInAgent(app);
    const stream = openStream(await listen(app), cookie);
    await stream.until(/retry/);
    expect(hub.subscriberCount).toBe(1);

    stream.close();
    for (let i = 0; i < 40 && hub.subscriberCount > 0; i++) await new Promise((r) => setTimeout(r, 25));
    expect(hub.subscriberCount).toBe(0);
  });
});
