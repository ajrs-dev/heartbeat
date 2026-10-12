import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeContext } from './helpers.js';

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'heartbeat-static-'));
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Heartbeat</title><div id="root"></div>');
  writeFileSync(path.join(dir, 'app.js'), 'console.log("hi")');
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('serving the built web app', () => {
  it('serves index.html at the root and static assets by path', async () => {
    const { app } = makeContext({ staticDir: dir });
    const root = await request(app).get('/');
    expect(root.status).toBe(200);
    expect(root.headers['content-type']).toMatch(/html/);
    expect(root.text).toContain('<div id="root">');
    expect((await request(app).get('/app.js')).status).toBe(200);
  });

  it('falls back to index.html for client-side routes, for GET and HEAD', async () => {
    const { app } = makeContext({ staticDir: dir });
    for (const route of ['/login', '/monitors/12', '/status/demo']) {
      const res = await request(app).get(route);
      expect(res.status, route).toBe(200);
      expect(res.text, route).toContain('<div id="root">');
    }
    // Some uptime tools probe with HEAD, so it must not 404.
    expect((await request(app).head('/status/demo')).status).toBe(200);
  });

  it('keeps unknown API routes as JSON 404s instead of returning the app shell', async () => {
    const { app } = makeContext({ staticDir: dir });
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  it('does not answer non-GET requests to page routes with the app shell', async () => {
    const { app } = makeContext({ staticDir: dir });
    expect((await request(app).post('/login').send({})).status).toBe(404);
  });

  it('sends security headers with the page', async () => {
    const { app } = makeContext({ staticDir: dir });
    const res = await request(app).get('/');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('serves only the API when no web build is configured', async () => {
    const { app } = makeContext({ staticDir: null });
    expect((await request(app).get('/api/health')).status).toBe(200);
    expect((await request(app).get('/')).status).toBe(404);
  });
});
