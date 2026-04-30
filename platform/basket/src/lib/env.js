import { z } from 'zod'
const envSchema = z.object({
  NODE_ENV:        z.enum(['development', 'test', 'production']).default('development'),
  PORT:            z.coerce.number().default(3004),
  REDIS_URL:       z.string().url(),
  EXPECTED_APP_ID: z.string().default('platform'),
  LOG_LEVEL:       z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
})
const parsed = envSchema.safeParse(process.env)
if (!parsed.success) { console.error(parsed.error.flatten().fieldErrors); process.exit(1) }
export const env = parsed.data
