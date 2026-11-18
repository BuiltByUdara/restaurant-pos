// Two disposable replica sets only; never reads .env or contacts restaurant data.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { backup, restore } from './backup.mjs';

const root = resolve('.cache');
await mkdir(root, { recursive: true });
const temporary = await mkdtemp(join(root, 'backup-drill-'));
const replicas = [];
const connections = [];
try {
  for (let i = 0; i < 2; i++)
    replicas.push(
      await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: '7.0.24' } }),
    );
  for (const replica of replicas)
    connections.push(await mongoose.createConnection(replica.getUri('restore_drill')).asPromise());
  const [source, target] = connections;
  await source.db
    .collection('orders')
    .insertOne({ _id: 'order-1', totalMinor: 12345, status: 'COMPLETED' });
  await source.db.collection('payments').createIndex({ key: 1 }, { unique: true });
  await source.db.collection('payments').insertOne({ key: 'payment-1', amountMinor: 12345 });
  await source.db.collection('sessions').insertOne({ currentHash: 'must-not-restore' });
  const configs = [join(temporary, 'source.json'), join(temporary, 'target.json')];
  for (let i = 0; i < 2; i++)
    await writeFile(configs[i], JSON.stringify({ uri: replicas[i].getUri('restore_drill') }), {
      mode: 0o600,
    });
  const directory = join(temporary, 'archive');
  const dump = {
    configFile: configs[0],
    directory,
    writesStopped: true,
    tool: process.env.MONGODUMP_BIN || 'mongodump',
  };
  const load = {
    configFile: configs[1],
    directory,
    writesStopped: true,
    tool: process.env.MONGORESTORE_BIN || 'mongorestore',
  };
  await assert.rejects(backup({ ...dump, writesStopped: false }), /Stop all/);
  await backup(dump);
  await restore(load);
  assert.equal(
    (await target.db.collection('orders').findOne({ _id: 'order-1' })).totalMinor,
    12345,
  );
  assert.equal(await target.db.collection('sessions').countDocuments(), 0);
  assert.ok(
    (await target.db.collection('payments').indexes()).some(
      (index) => index.unique && index.key.key === 1,
    ),
  );
  await assert.rejects(restore(load), /must be empty/);
  const manifestFile = join(directory, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  await writeFile(manifestFile, JSON.stringify({ ...manifest, sha256: 'bad' }));
  await assert.rejects(restore(load), /checksum mismatch/);
  console.log(
    'PASS: isolated backup/restore, financial values, indexes, session exclusion, overwrite refusal and corruption detection.',
  );
} finally {
  for (const connection of connections) await connection.close();
  for (const replica of replicas) await replica.stop();
  if (!resolve(temporary).startsWith(root + sep + 'backup-drill-'))
    throw new Error('Unsafe cleanup path');
  await rm(temporary, { recursive: true, force: true });
}
