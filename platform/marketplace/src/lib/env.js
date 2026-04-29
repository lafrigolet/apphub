import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV:                       z.enum(['development', 'test', 'production']).default('development'),
  PLATFORM_MARKETPLACE_PORT:      z.coerce.number().default(3100),
  MIGRATION_DATABASE_URL:         z.string().url(),
  REDIS_URL:                      z.string().url(),
  PLATFORM_JWT_SECRET:            z.string().min(32),
  EXPECTED_APP_ID:                z.string().default('platform'),
  LOG_LEVEL:                      z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  ALLOWED_ORIGINS:                z.string().optional(),

  // Per-module DATABASE_URLs — one Pool per module, each bound to its dedicated role.
  DATABASE_URL_ORDERS:            z.string().url(),
  DATABASE_URL_INVENTORY:         z.string().url(),
  DATABASE_URL_REVIEWS:           z.string().url(),
  DATABASE_URL_MESSAGING:         z.string().url(),
  DATABASE_URL_SHIPPING:          z.string().url(),
  DATABASE_URL_DISPUTES:          z.string().url(),
  DATABASE_URL_CATALOG:           z.string().url(),
  // basket has no DATABASE_URL — it's a Redis-only module.

  // Cross-container HTTP base URL. Some marketplace modules (reviews, disputes)
  // need to look up data on platform-core (e.g. verified-purchase check).
  PLATFORM_CORE_URL:              z.string().url().default('http://platform-core:3000'),
})

const parsed = envSchema.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid environment variables for platform-marketplace:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
