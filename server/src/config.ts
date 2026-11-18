import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
// Bundled production code is in server/dist, at the same depth as server/src.
export const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(60).max(6000).default(600),
    MONGODB_URI: z.string().min(1),
    JWT_SECRET: z.string().min(48),
    CLIENT_ORIGIN: z
      .string()
      .url()
      .refine((value) => {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) && value === url.origin;
      }, 'Use an exact HTTP(S) origin without a path or trailing slash'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
  })
  .superRefine((config, ctx) => {
    if (config.NODE_ENV !== 'production') return;
    if (!config.CLIENT_ORIGIN.startsWith('https://'))
      ctx.addIssue({
        code: 'custom',
        path: ['CLIENT_ORIGIN'],
        message: 'Production requires HTTPS',
      });
    const uri = config.MONGODB_URI;
    if (
      !/^mongodb(?:\+srv)?:\/\/[^/@]+:[^/@]+@/.test(uri) ||
      (!uri.startsWith('mongodb+srv://') && !/[?&]replicaSet=[^&]+/.test(uri)) ||
      /[?&](tls|ssl)=false/i.test(uri) ||
      /[?&](tlsInsecure|tlsAllowInvalidCertificates|tlsAllowInvalidHostnames)=true/i.test(uri) ||
      (!uri.startsWith('mongodb+srv://') && !/[?&](tls|ssl)=true/i.test(uri))
    )
      ctx.addIssue({
        code: 'custom',
        path: ['MONGODB_URI'],
        message: 'Production requires authenticated TLS replica-set MongoDB',
      });
  });
export type Config = z.infer<typeof configSchema>;
export function readConfig(): Config {
  const env = { ...process.env };
  for (const key of ['JWT_SECRET', 'MONGODB_URI'] as const) {
    if (env[`${key}_FILE`]) {
      if (env[key]) throw new Error(`Set only ${key} or ${key}_FILE`);
      env[key] = readFileSync(env[`${key}_FILE`]!, 'utf8').trim();
    }
  }
  const parsed = configSchema.safeParse(env);
  if (!parsed.success)
    throw new Error(
      `Invalid configuration fields: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    );
  return parsed.data;
}
