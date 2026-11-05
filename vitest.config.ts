import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 180000,
    fileParallelism: false,
    env: { MONGOMS_DOWNLOAD_DIR: 'node_modules/.cache/mongodb-memory-server' },
  },
});
