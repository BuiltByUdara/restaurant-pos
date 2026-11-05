// Dedicated temporary database. Never seeds or resets the developer's database.
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createServer } from 'node:http';
import { createApp } from '../server/src/app';
import { attachRealtime } from '../server/src/realtime';
import { Role, User } from '../server/src/modules/auth/models';
import { passwordHash } from '../server/src/modules/auth/service';
import { rolePermissions } from '../shared/src';
const mongo = await MongoMemoryReplSet.create({
  replSet: { count: 1 },
  binary: { version: '7.0.24' },
});
await mongoose.connect(mongo.getUri());
for (const name of ['Owner', 'Cashier'] as const) {
  const role = await Role.create({ name, permissions: rolePermissions[name] });
  await User.create({
    name: `Test ${name}`,
    email: `${name.toLowerCase()}@example.test`,
    passwordHash: await passwordHash('Test-password-only-123!'),
    role: role._id,
  });
}
const config = {
  NODE_ENV: 'test' as const,
  PORT: 4100,
  MONGODB_URI: mongo.getUri(),
  JWT_SECRET: 'ephemeral-e2e-secret-'.repeat(4),
  CLIENT_ORIGIN: 'http://localhost:5174',
  LOG_LEVEL: 'silent' as const,
};
const { app, auth } = createApp(config);
const http = createServer(app);
const io = attachRealtime(http, auth, config);
http.listen(4100, '127.0.0.1');
const stop = async () => {
  io.close();
  http.close();
  await mongoose.disconnect();
  await mongo.stop();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
