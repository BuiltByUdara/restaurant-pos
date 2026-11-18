import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import mongoose from 'mongoose';

export class BackupError extends Error {}
const fail = (message) => {
  throw new BackupError(message);
};
const run = promisify(execFile);
async function checksum(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function connect(configFile) {
  // JSON is also valid YAML for the Database Tools --config option.
  const config = JSON.parse(await readFile(configFile, 'utf8'));
  if (Object.keys(config).some((key) => key !== 'uri')) fail('Config must contain only uri.');
  const database = /^mongodb(?:\+srv)?:\/\/[^/]+\/([a-zA-Z0-9_-]+)(?:\?|$)/.exec(config.uri)?.[1];
  if (!database || ['admin', 'local', 'config'].includes(database))
    fail('Use an explicit application database in the URI.');
  const connection = await mongoose
    .createConnection(config.uri, { serverSelectionTimeoutMS: 10000 })
    .asPromise();
  try {
    const hello = await connection.db.admin().command({ hello: 1 });
    if (!hello.setName || !hello.isWritablePrimary) fail('A writable replica set is required.');
    return { connection, database };
  } catch (error) {
    await connection.close();
    throw error;
  }
}
async function inventory(db) {
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  const counts = {};
  for (const { name } of collections.sort((a, b) => a.name.localeCompare(b.name))) {
    if (name === 'sessions' || name.startsWith('system.')) continue;
    counts[name] = await db.collection(name).countDocuments();
  }
  return counts;
}
export async function backup({ configFile, directory, writesStopped, tool = 'mongodump' }) {
  if (!writesStopped) fail('Stop all application writers and pass --writes-stopped.');
  const { connection, database } = await connect(configFile);
  try {
    // A new directory is required: never overwrite a previous backup.
    await mkdir(directory, { mode: 0o700 });
    const archive = join(directory, 'database.archive.gz');
    await writeFile(archive, '', { flag: 'wx', mode: 0o600 });
    const before = await inventory(connection.db);
    await run(
      tool,
      [
        '--config',
        resolve(configFile),
        '--gzip',
        `--archive=${resolve(archive)}`,
        '--excludeCollection=sessions',
      ],
      { maxBuffer: 1024 * 1024 },
    );
    await chmod(archive, 0o600);
    const after = await inventory(connection.db);
    if (JSON.stringify(before) !== JSON.stringify(after))
      fail('Collection counts changed. Backup is incomplete; retry after stopping writers.');
    const manifest = {
      format: 1,
      database,
      createdAt: new Date().toISOString(),
      sha256: await checksum(archive),
      counts: after,
      sessionsExcluded: true,
    };
    // Manifest is the completion marker. Failed backups have no manifest.
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), {
      flag: 'wx',
      mode: 0o600,
    });
    return manifest;
  } finally {
    await connection.close();
  }
}
export async function restore({ configFile, directory, writesStopped, tool = 'mongorestore' }) {
  if (!writesStopped) fail('Stop all application writers and pass --writes-stopped.');
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  if (
    manifest.format !== 1 ||
    !manifest.sessionsExcluded ||
    !manifest.counts ||
    typeof manifest.counts !== 'object'
  )
    fail('Unsupported backup manifest.');
  const archive = join(directory, 'database.archive.gz');
  if ((await checksum(archive)) !== manifest.sha256) fail('Backup checksum mismatch.');
  const { connection, database } = await connect(configFile);
  try {
    if (database !== manifest.database)
      fail('Restore database name must match the backup. Use a separate replica set.');
    if ((await connection.db.listCollections().toArray()).length)
      fail('Restore target must be empty. No existing data will be overwritten.');
    await run(
      tool,
      [
        '--config',
        resolve(configFile),
        '--gzip',
        `--archive=${resolve(archive)}`,
        `--nsInclude=${database}.*`,
        `--nsExclude=${database}.sessions`,
        '--stopOnError',
      ],
      { maxBuffer: 1024 * 1024 },
    );
    const counts = await inventory(connection.db);
    if (JSON.stringify(counts) !== JSON.stringify(manifest.counts))
      fail('Restored counts do not match. Keep the target isolated for investigation.');
    return { database, counts, sessionsRestored: 0 };
  } finally {
    await connection.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [action, configFile, directory, acknowledgement] = process.argv.slice(2);
  if (
    !['backup', 'restore'].includes(action) ||
    !configFile ||
    !directory ||
    acknowledgement !== '--writes-stopped'
  ) {
    console.error(
      'Usage: node scripts/backup.mjs backup|restore <secret-config.json> <backup-directory> --writes-stopped',
    );
    process.exitCode = 1;
  } else {
    try {
      await (action === 'backup' ? backup : restore)({
        configFile,
        directory,
        writesStopped: true,
        tool:
          process.env[action === 'backup' ? 'MONGODUMP_BIN' : 'MONGORESTORE_BIN'] ||
          (action === 'backup' ? 'mongodump' : 'mongorestore'),
      });
      console.log(
        `${action} completed and verified. Keep archives encrypted and access restricted.`,
      );
    } catch (error) {
      // Native tool/driver errors can include credential-bearing URIs; never echo them.
      console.error(
        error instanceof BackupError
          ? error.message
          : 'Operation failed. Check tool installation, config, permissions and connectivity. No credential diagnostics are printed.',
      );
      process.exitCode = 1;
    }
  }
}
