import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV:               z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL:           z.string().url(),
  MIGRATION_DATABASE_URL: z.string().url().optional(),
  REDIS_URL:              z.string().url(),
  EXPECTED_APP_ID:        z.string().default('platform'),
  LOG_LEVEL:              z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),

  // Loopback for verified-purchase HTTP check. Defaults to localhost because
  // reviews runs inside the platform-marketplace container alongside orders.
  PLATFORM_MARKETPLACE_URL: z.string().url().default('http://localhost:3100'),
})

const parsed = envSchema.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid env for platform-reviews:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
