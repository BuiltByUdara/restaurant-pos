import { it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { configSchema, type Config } from '../server/src/config';
import { databaseReady } from '../server/src/lib/readiness';
import { createApp } from '../server/src/app';

const config: Config = {
  NODE_ENV: 'test',
  PORT: 4000,
  API_RATE_LIMIT_PER_MINUTE: 600,
  MONGODB_URI: 'mongodb://localhost/pos?replicaSet=rs0',
  JWT_SECRET: 'isolated-test-secret-'.repeat(4),
  CLIENT_ORIGIN: 'http://localhost:5173',
  LOG_LEVEL: 'silent',
};
afterEach(() => vi.restoreAllMocks());
it('requires secure production configuration and exact browser origins', () => {
  expect(configSchema.safeParse({ ...config, NODE_ENV: 'production' }).success).toBe(false);
  const production = {
    ...config,
    NODE_ENV: 'production',
    CLIENT_ORIGIN: 'https://pos.example.test',
    MONGODB_URI: 'mongodb://user:password@db/pos?replicaSet=rs0&tls=true',
  };
  expect(configSchema.safeParse(production).success).toBe(true);
  for (const uri of [
    'mongodb://db/pos?replicaSet=rs0&tls=true',
    'mongodb://user:password@db/pos?tls=true',
    production.MONGODB_URI + '&tlsAllowInvalidCertificates=true',
  ])
    expect(configSchema.safeParse({ ...production, MONGODB_URI: uri }).success).toBe(false);
  expect(
    configSchema.safeParse({ ...config, CLIENT_ORIGIN: 'http://localhost:5173/path' }).success,
  ).toBe(false);
});
it('keeps liveness available but fails readiness when disconnected or draining', async () => {
  expect(await databaseReady()).toBe(false);
  const { app } = createApp(config, { stopping: true });
  await request(app).get('/api/v1/live').expect(200);
  await request(app).get('/api/v1/health').expect(503);
  await request(app).get('/api/v1/staff').expect(503);
});
it('rejects standalone and non-primary database readiness', async () => {
  vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(1);
  const command = vi.fn();
  const original = mongoose.connection.db;
  mongoose.connection.db = { admin: () => ({ command }) } as never;
  try {
    command.mockResolvedValue({ isWritablePrimary: true });
    expect(await databaseReady()).toBe(false);
    command.mockResolvedValue({ setName: 'rs0', isWritablePrimary: false });
    expect(await databaseReady()).toBe(false);
    command.mockResolvedValue({ setName: 'rs0', isWritablePrimary: true });
    expect(await databaseReady()).toBe(true);
    command.mockRejectedValue(new Error('connection failed'));
    expect(await databaseReady()).toBe(false);
  } finally {
    mongoose.connection.db = original;
  }
});
it('rejects oversized and malformed JSON without leaking internal details', async () => {
  const { app } = createApp(config);
  for (const [body, status] of [
    ['{broken', 400],
    [JSON.stringify({ value: 'x'.repeat(20000) }), 413],
  ] as const) {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send(body)
      .expect(status);
    expect(response.body.error.code).toBe('INVALID_BODY');
    expect(JSON.stringify(response.body)).not.toContain('stack');
  }
  await request(app)
    .post('/api/v1/auth/login')
    .set('Origin', 'https://attacker.example')
    .send({})
    .expect(403);
});
