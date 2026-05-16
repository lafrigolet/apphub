import { z } from 'zod'
const envSchema = z.object({
  NODE_ENV:             z.enum(['development', 'test', 'production']).default('development'),
  PORT:                 z.coerce.number().default(3002),
  DATABASE_URL:         z.string().url(),
  MIGRATION_DATABASE_URL: z.string().url().optional(),
  REDIS_URL:            z.string().url(),
  EXPECTED_APP_ID:      z.string().default('platform'),
  LOG_LEVEL:            z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  SENDGRID_API_KEY:     z.string().default('dev_no_sendgrid'),
  SENDGRID_FROM_EMAIL:  z.string().email().default('noreply@hulkstein.local'),
})
const parsed = envSchema.safeParse(process.env)
if (!parsed.success) { console.error(parsed.error.flatten().fieldErrors); process.exit(1) }
export const env = parsed.data
