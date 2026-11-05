import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
// Bundled production code is in server/dist, at the same depth as server/src.
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  MONGODB_URI: z.string().min(1),
  JWT_SECRET: z.string().min(48),
  CLIENT_ORIGIN: z.string().url(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});
export type Config = z.infer<typeof schema>;
export function readConfig(): Config {
  return schema.parse(process.env);
}
