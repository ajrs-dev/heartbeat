import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/auth.js';
import { makeContext, signedInAgent } from './helpers.js';

describe('password hashing', () => {
  it('verifies the right password and rejects the wrong one', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('wrong password!!', hash)).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same-password-123')).not.toBe(await hashPassword('same-password-123'));
  });

  it('never accepts a login when there is no stored hash', async () => {
    expect(await verifyPassword('anything', null)).toBe(false);
  });
});

describe('auth routes', () => {
  it('registers, sets a hardened session cookie and returns the user', async () => {
    const { app } = makeContext({ production: true });
    const res = await request(app).post('/api/auth/register').send({ email: 'A@Example.com', password: 'correct horse battery' });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('a@example.com'); // normalised
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/hb_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Secure/i);
  });

  it('never stores the raw password or raw session token', async () => {
    const { app, db } = makeContext();
    const { cookie } = await signedInAgent(app);
    const user = db.prepare('SELECT password_hash FROM users').get() as { password_hash: string };
    expect(user.password_hash).not.toContain('correct horse battery');
    const token = /hb_session=([^;]+)/.exec(cookie)?.[1];
    const sessions = db.prepare('SELECT token_hash FROM sessions').all() as { token_hash: string }[];
    expect(token).toBeTruthy();
    expect(sessions.map((s) => s.token_hash)).not.toContain(token);
  });

  it('rejects weak passwords, bad emails and duplicate accounts', async () => {
    const { app } = makeContext();
    expect((await request(app).post('/api/auth/register').send({ email: 'a@example.com', password: 'short' })).status).toBe(400);
    expect((await request(app).post('/api/auth/register').send({ email: 'nope', password: 'correct horse battery' })).status).toBe(400);
    await signedInAgent(app, 'dup@example.com');
    const dup = await request(app).post('/api/auth/register').send({ email: 'DUP@example.com', password: 'correct horse battery' });
    expect(dup.status).toBe(409);
  });

  it('logs in with the right credentials and rejects the wrong ones with the same message', async () => {
    const { app } = makeContext();
    await signedInAgent(app, 'me@example.com');
    const good = await request(app).post('/api/auth/login').send({ email: 'me@example.com', password: 'correct horse battery' });
    expect(good.status).toBe(200);
    const wrongPassword = await request(app).post('/api/auth/login').send({ email: 'me@example.com', password: 'incorrect password' });
    const unknownEmail = await request(app).post('/api/auth/login').send({ email: 'ghost@example.com', password: 'incorrect password' });
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.error).toBe(unknownEmail.body.error);
  });

  it('protects /me, and logout invalidates the session server-side', async () => {
    const { app } = makeContext();
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    const { agent, user, cookie } = await signedInAgent(app);
    expect((await agent.get('/api/auth/me')).body.user.id).toBe(user.id);
    expect((await agent.post('/api/auth/logout')).status).toBe(204);
    // Replaying the old cookie must fail: the session is gone from the database, not just the browser.
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(401);
  });

  it('rate-limits repeated auth attempts', async () => {
    const { app } = makeContext({ authRateLimit: { max: 3, windowMs: 60_000 } });
    const attempt = () => request(app).post('/api/auth/login').send({ email: 'x@example.com', password: 'whatever-it-is' });
    for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(401);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('blocks cross-origin state-changing requests', async () => {
    const { app } = makeContext();
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ email: 'me@example.com', password: 'correct horse battery' });
    expect(res.status).toBe(403);
  });

  it('returns 400 for malformed JSON instead of crashing', async () => {
    const { app } = makeContext();
    const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":');
    expect(res.status).toBe(400);
  });
});
