import { createServer } from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
const replica = await MongoMemoryReplSet.create({
  replSet: { count: 1 },
  binary: { version: '7.0.24' },
});
let child;
try {
  const reservation = createServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(port),
    MONGODB_URI: replica.getUri('runtime_smoke'),
    JWT_SECRET: 'runtime-only-test-secret-'.repeat(4),
    CLIENT_ORIGIN: 'http://localhost:5174',
    LOG_LEVEL: 'silent',
    SEED_OWNER_NAME: 'Smoke Owner',
    SEED_OWNER_EMAIL: 'runtime@example.test',
    SEED_OWNER_PASSWORD: 'Smoke-test-password-123!',
  };
  delete env.JWT_SECRET_FILE;
  delete env.MONGODB_URI_FILE;
  await promisify(execFile)(process.execPath, ['server/dist/seed.js'], { env });
  child = spawn(process.execPath, ['server/dist/index.js'], { env, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}/api/v1`;
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error('Compiled API exited before readiness');
    try {
      ready = (await fetch(base + '/health', { signal: AbortSignal.timeout(3000) })).ok;
    } catch {}
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(ready, 'Compiled API must become ready');
  assert.equal((await fetch(base + '/staff')).status, 401);
  const login = await fetch(base + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.SEED_OWNER_EMAIL, password: env.SEED_OWNER_PASSWORD }),
  });
  assert.equal(login.status, 200);
  const identity = await login.json();
  assert.equal(identity.data.user.role, 'Owner');
  console.log(
    'PASS: compiled bootstrap, server startup, database readiness, protected endpoint and owner login.',
  );
} finally {
  if (child && child.exitCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 12000);
    await exited;
    clearTimeout(timer);
  }
  await replica.stop();
}
