import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { makeContext, signedInAgent } from './helpers.js';

const monitor = { name: 'Example', url: 'https://example.com/health', intervalSec: 60 };

describe('monitor CRUD', () => {
  it('requires authentication', async () => {
    const { app } = makeContext();
    expect((await request(app).get('/api/monitors')).status).toBe(401);
    expect((await request(app).post('/api/monitors').send(monitor)).status).toBe(401);
  });

  it('creates, reads, updates and deletes a monitor', async () => {
    const { app } = makeContext();
    const { agent } = await signedInAgent(app);

    const created = await agent.post('/api/monitors').send(monitor);
    expect(created.status).toBe(201);
    expect(created.body.monitor).toMatchObject({ name: 'Example', intervalSec: 60, timeoutMs: 10_000, status: 'pending', isPublic: false });
    const id = created.body.monitor.id;

    expect((await agent.get(`/api/monitors/${id}`)).body.monitor.name).toBe('Example');
    const updated = await agent.patch(`/api/monitors/${id}`).send({ name: 'Renamed', isPaused: true, isPublic: true });
    expect(updated.body.monitor).toMatchObject({ name: 'Renamed', isPaused: true, isPublic: true, status: 'paused' });
    expect((await agent.get('/api/monitors')).body.monitors).toHaveLength(1);

    expect((await agent.delete(`/api/monitors/${id}`)).status).toBe(204);
    expect((await agent.get(`/api/monitors/${id}`)).status).toBe(404);
  });

  it("never lets one user see or change another user's monitor", async () => {
    const { app } = makeContext();
    const alice = await signedInAgent(app, 'alice@example.com');
    const bob = await signedInAgent(app, 'bob@example.com');
    const id = (await alice.agent.post('/api/monitors').send(monitor)).body.monitor.id;

    for (const res of [
      await bob.agent.get(`/api/monitors/${id}`),
      await bob.agent.patch(`/api/monitors/${id}`).send({ name: 'hacked' }),
      await bob.agent.delete(`/api/monitors/${id}`),
      await bob.agent.get(`/api/monitors/${id}/stats`),
      await bob.agent.get(`/api/monitors/${id}/checks`),
      await bob.agent.get(`/api/monitors/${id}/incidents`),
    ]) {
      expect(res.status).toBe(404);
    }
    expect((await bob.agent.get('/api/monitors')).body.monitors).toEqual([]);
    expect((await alice.agent.get(`/api/monitors/${id}`)).body.monitor.name).toBe('Example');
  });

  it('validates input', async () => {
    const { app } = makeContext();
    const { agent } = await signedInAgent(app);
    expect((await agent.post('/api/monitors').send({ name: '', url: monitor.url })).status).toBe(400);
    expect((await agent.post('/api/monitors').send({ name: 'x', url: 'not a url' })).status).toBe(400);
    expect((await agent.post('/api/monitors').send({ ...monitor, intervalSec: 5 })).status).toBe(400); // below minimum
    expect((await agent.post('/api/monitors').send({ ...monitor, timeoutMs: 999_999 })).status).toBe(400);
    expect((await agent.post('/api/monitors').send({ ...monitor, intervalSec: '60' })).status).toBe(400);
    const id = (await agent.post('/api/monitors').send(monitor)).body.monitor.id;
    expect((await agent.patch(`/api/monitors/${id}`).send({})).status).toBe(400);
    expect((await agent.get('/api/monitors/abc')).status).toBe(404);
  });

  it('refuses private and internal targets (SSRF)', async () => {
    const { app } = makeContext();
    const { agent } = await signedInAgent(app);
    for (const url of ['http://127.0.0.1/', 'http://localhost:3000', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'ftp://example.com']) {
      const res = await agent.post('/api/monitors').send({ name: 'bad', url });
      expect(res.status, url).toBe(400);
    }
    const id = (await agent.post('/api/monitors').send(monitor)).body.monitor.id;
    expect((await agent.patch(`/api/monitors/${id}`).send({ url: 'http://10.0.0.1/' })).status).toBe(400);
  });

  it('caps the number of monitors per user', async () => {
    const { app } = makeContext({ maxMonitorsPerUser: 2 });
    const { agent } = await signedInAgent(app);
    expect((await agent.post('/api/monitors').send(monitor)).status).toBe(201);
    expect((await agent.post('/api/monitors').send(monitor)).status).toBe(201);
    expect((await agent.post('/api/monitors').send(monitor)).status).toBe(409);
  });
});

describe('public status page', () => {
  it('exposes only public monitors, and only their names and health', async () => {
    const { app } = makeContext();
    const { agent, user } = await signedInAgent(app);
    await agent.post('/api/monitors').send({ ...monitor, name: 'Public API', isPublic: true });
    await agent.post('/api/monitors').send({ ...monitor, name: 'Secret admin panel', isPublic: false });

    const res = await request(app).get(`/api/public/${user.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.monitors.map((m: { name: string }) => m.name)).toEqual(['Public API']);
    expect(JSON.stringify(res.body)).not.toContain('example.com');
    expect(JSON.stringify(res.body)).not.toContain('Secret admin panel');
    expect((await request(app).get('/api/public/doesnotexist')).status).toBe(404);
  });
});
