import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npx tsx tests/e2e-server.ts',
      env: { MONGOMS_DOWNLOAD_DIR: 'node_modules/.cache/mongodb-memory-server' },
      url: 'http://127.0.0.1:4100/api/v1/health',
      reuseExistingServer: false,
      timeout: 180000,
    },
    {
      command: 'npm run dev -w client -- --port 5174',
      env: { POS_API_URL: 'http://127.0.0.1:4100' },
      url: 'http://localhost:5174',
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});
