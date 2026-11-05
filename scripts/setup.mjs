import { readFile, writeFile, access } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
const target = new URL('../.env', import.meta.url);
try {
  await access(target);
  console.log('.env already exists; left unchanged.');
} catch {
  const example = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
  await writeFile(
    target,
    example
      .replace('JWT_SECRET=\n', `JWT_SECRET=${randomBytes(48).toString('hex')}\n`)
      .replace(
        'SEED_OWNER_PASSWORD=\n',
        `SEED_OWNER_PASSWORD=${randomBytes(18).toString('base64url')}\n`,
      ),
    { flag: 'wx', mode: 0o600 },
  );
  console.log(
    'Created .env with random secrets. Review your owner email and password there before seeding.',
  );
}
