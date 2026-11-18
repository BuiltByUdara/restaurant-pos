import { spawnSync } from 'node:child_process';
// Two fresh-server batches keep the real ten-login throttle enabled. No test bypass API.
for (const args of [['--grep-invert', 'owner manages staff'], ['tests/e2e/reporting.spec.ts']]) {
  const result = spawnSync(
    process.execPath,
    ['node_modules/@playwright/test/cli.js', 'test', ...args],
    { stdio: 'inherit' },
  );
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
