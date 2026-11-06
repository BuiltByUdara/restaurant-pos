import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { io as socketClient } from 'socket.io-client';
import { createApp } from '../server/src/app';
import { attachRealtime } from '../server/src/realtime';
import { Role, User, Session, AuditLog } from '../server/src/modules/auth/models';
import { passwordHash } from '../server/src/modules/auth/service';
import { rolePermissions } from '../shared/src';
import type { Config } from '../server/src/config';

let mongo: MongoMemoryReplSet;
const config: Config = {
  NODE_ENV: 'test',
  PORT: 4000,
  API_RATE_LIMIT_PER_MINUTE: 600,
  MONGODB_URI: '',
  JWT_SECRET: 'test-only-secret-'.repeat(5),
  CLIENT_ORIGIN: 'http://localhost:5173',
  LOG_LEVEL: 'silent',
};
let app: ReturnType<typeof createApp>['app'];
let ownerId: string;
const credentials = { email: 'owner@example.test', password: 'Test-password-only-123!' };
function cookie(res: request.Response) {
  return (res.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
}
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    binary: { version: '7.0.24' },
  });
  await mongoose.connect(mongo.getUri());
  await Promise.all([Role.init(), User.init(), Session.init(), AuditLog.init()]);
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});
beforeEach(async () => {
  await Promise.all([
    Role.deleteMany({}),
    User.deleteMany({}),
    Session.deleteMany({}),
    AuditLog.deleteMany({}),
  ]);
  const ownerRole = await Role.create({ name: 'Owner', permissions: rolePermissions.Owner });
  const cashierRole = await Role.create({ name: 'Cashier', permissions: rolePermissions.Cashier });
  const hashed = await passwordHash(credentials.password);
  const owner = await User.create({
    name: 'Test Owner',
    ...credentials,
    password: undefined,
    passwordHash: hashed,
    role: ownerRole._id,
  });
  ownerId = owner.id;
  await User.create({
    name: 'Test Cashier',
    email: 'cashier@example.test',
    passwordHash: hashed,
    role: cashierRole._id,
  });
  app = createApp(config).app;
});
describe('Phase 1 authentication and permissions', () => {
  it('seeds all six roles idempotently without resetting an existing password', async () => {
    const before = await User.findById(ownerId).select('+passwordHash');
    const run = () =>
      promisify(execFile)(process.execPath, ['--import', 'tsx', 'server/src/seed.ts'], {
        env: {
          ...process.env,
          NODE_ENV: 'test',
          MONGODB_URI: mongo.getUri(),
          JWT_SECRET: config.JWT_SECRET,
          CLIENT_ORIGIN: config.CLIENT_ORIGIN,
          SEED_OWNER_NAME: 'Test Owner',
          SEED_OWNER_EMAIL: credentials.email,
          SEED_OWNER_PASSWORD: 'A-new-password-not-applied',
        },
      });
    await run();
    await run();
    expect(await Role.countDocuments()).toBe(6);
    expect(await User.countDocuments({ email: credentials.email })).toBe(1);
    const after = await User.findById(ownerId).select('+passwordHash');
    expect(after!.passwordHash).toBe(before!.passwordHash);
  });
  it('hashes passwords with Argon2id and never returns credential fields', async () => {
    const db = await User.findById(ownerId).select('+passwordHash');
    expect(db!.passwordHash).toMatch(/^\$argon2id\$/);
    const res = await request(app).post('/api/v1/auth/login').send(credentials).expect(200);
    expect(res.body.data.user.role).toBe('Owner');
    expect(JSON.stringify(res.body)).not.toContain('password');
    expect(res.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(res.headers['set-cookie'][0]).toContain('SameSite=Strict');
    const stored = await Session.findOne().select('+currentHash');
    expect(stored!.currentHash).not.toContain(cookie(res).split('.')[1]);
    const me = await request(app)
      .get('/api/v1/auth/me')
      .auth(res.body.data.accessToken, { type: 'bearer' })
      .expect(200);
    expect(me.body.data.email).toBe(credentials.email);
  });
  it('rejects invalid inputs, invalid passwords, and unknown identities', async () => {
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: { $ne: null }, password: 'x' })
      .expect(400);
    const bad = await request(app)
      .post('/api/v1/auth/login')
      .send({ ...credentials, password: 'wrong' })
      .expect(401);
    const missing = await request(app)
      .post('/api/v1/auth/login')
      .send({ ...credentials, email: 'unknown@example.test' })
      .expect(401);
    expect(bad.body.error.message).toBe(missing.body.error.message);
  });
  it('protects API routes and restricts staff records by permission', async () => {
    await request(app).get('/api/v1/staff').expect(401);
    const cashier = await request(app)
      .post('/api/v1/auth/login')
      .send({ ...credentials, email: 'cashier@example.test' });
    await request(app)
      .get('/api/v1/staff')
      .auth(cashier.body.data.accessToken, { type: 'bearer' })
      .expect(403);
    const owner = await request(app).post('/api/v1/auth/login').send(credentials);
    const staff = await request(app)
      .get('/api/v1/staff?limit=1')
      .auth(owner.body.data.accessToken, { type: 'bearer' })
      .expect(200);
    expect(staff.body.data).toHaveLength(1);
    expect(staff.body.pagination.total).toBe(2);
    expect(JSON.stringify(staff.body)).not.toContain('passwordHash');
  });
  it('rotates refresh tokens and revokes the session when a consumed token is replayed', async () => {
    const login = await request(app).post('/api/v1/auth/login').send(credentials);
    const refreshed = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie(login))
      .expect(200);
    expect(cookie(refreshed)).not.toBe(cookie(login));
    await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie(login)).expect(401);
    await request(app)
      .get('/api/v1/auth/me')
      .auth(refreshed.body.data.accessToken, { type: 'bearer' })
      .expect(401);
    expect(await AuditLog.countDocuments({ action: 'auth.refresh_replay' })).toBe(1);
  });
  it('allows only one concurrent rotation of a refresh token', async () => {
    const login = await request(app).post('/api/v1/auth/login').send(credentials);
    const res = await Promise.all(
      [1, 2].map(() => request(app).post('/api/v1/auth/refresh').set('Cookie', cookie(login))),
    );
    expect(res.map((r) => r.status).sort()).toEqual([200, 401]);
  });
  it('revokes access and refresh on logout and records the action', async () => {
    const login = await request(app).post('/api/v1/auth/login').send(credentials);
    await request(app).post('/api/v1/auth/logout').set('Cookie', cookie(login)).expect(204);
    await request(app)
      .get('/api/v1/auth/me')
      .auth(login.body.data.accessToken, { type: 'bearer' })
      .expect(401);
    await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie(login)).expect(401);
    expect(await AuditLog.countDocuments({ action: 'auth.logout' })).toBe(1);
  });
  it('rejects disabled staff even with a previously issued token', async () => {
    const login = await request(app).post('/api/v1/auth/login').send(credentials);
    await User.updateOne({ _id: ownerId }, { $set: { active: false } });
    await request(app)
      .get('/api/v1/auth/me')
      .auth(login.body.data.accessToken, { type: 'bearer' })
      .expect(401);
    await request(app).post('/api/v1/auth/login').send(credentials).expect(401);
  });
  it('checks current permissions rather than trusting stale token claims', async () => {
    const login = await request(app).post('/api/v1/auth/login').send(credentials);
    await Role.updateOne({ name: 'Owner' }, { $set: { permissions: [] } });
    await request(app)
      .get('/api/v1/staff')
      .auth(login.body.data.accessToken, { type: 'bearer' })
      .expect(403);
  });
  it('rejects expired sessions and malformed access tokens', async () => {
    const login = await request(app).post('/api/v1/auth/login').send(credentials);
    await Session.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie(login)).expect(401);
    await request(app).get('/api/v1/auth/me').auth('not-a-token', { type: 'bearer' }).expect(401);
  });
  it('rejects cross-origin mutations and applies secure headers', async () => {
    await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', 'https://untrusted.test')
      .send(credentials)
      .expect(403);
    const res = await request(app).get('/api/v1/health').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
  it('sets secure cookies in production', async () => {
    const production = createApp({ ...config, NODE_ENV: 'production' }).app;
    const res = await request(production).post('/api/v1/auth/login').send(credentials).expect(200);
    expect(res.headers['set-cookie'][0]).toContain('Secure');
  });
  it('rate-limits repeated login attempts', async () => {
    for (let i = 0; i < 10; i++)
      await request(app)
        .post('/api/v1/auth/login')
        .send({ ...credentials, password: 'wrong' })
        .expect(401);
    await request(app).post('/api/v1/auth/login').send(credentials).expect(429);
  });
  it('authenticates real Socket.IO connections', async () => {
    const authApp = createApp(config);
    const http = createServer(authApp.app);
    const realtime = attachRealtime(http, authApp.auth, config);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const address = http.address() as { port: number };
    const url = `http://127.0.0.1:${address.port}`;
    const login = await request(authApp.app).post('/api/v1/auth/login').send(credentials);
    const valid = socketClient(url, {
      auth: { token: login.body.data.accessToken },
      autoConnect: false,
      reconnection: false,
    });
    const invalid = socketClient(url, {
      auth: { token: 'invalid' },
      autoConnect: false,
      reconnection: false,
    });
    try {
      const ready = new Promise<{ userId: string }>((resolve) =>
        valid.once('session:ready', resolve),
      );
      valid.connect();
      expect((await ready).userId).toBe(ownerId);
      const rejected = new Promise<Error>((resolve) => invalid.once('connect_error', resolve));
      invalid.connect();
      expect((await rejected).message).toBe('Authentication required');
    } finally {
      valid.disconnect();
      invalid.disconnect();
      await new Promise<void>((resolve) => realtime.close(() => resolve()));
    }
  });
});
