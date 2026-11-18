import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/index.ts', 'src/seed.ts', 'src/migrate-phase2.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  noExternal: ['@restaurant/shared'],
  clean: true,
});
