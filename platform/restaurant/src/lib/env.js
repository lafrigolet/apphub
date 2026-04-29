import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV:                       z.enum(['development', 'test', 'production']).default('development'),
  PLATFORM_RESTAURANT_PORT:       z.coerce.number().default(3200),
  MIGRATION_DATABASE_URL:         z.string().url(),
  REDIS_URL:                      z.string().url(),
  PLATFORM_JWT_SECRET:            z.string().min(32),
  EXPECTED_APP_ID:                z.string().default('platform'),
  LOG_LEVEL:                      z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  ALLOWED_ORIGINS:                z.string().optional(),

  // Per-module DATABASE_URLs — one Pool per module, each bound to its dedicated role.
  DATABASE_URL_MENU:              z.string().url(),
  DATABASE_URL_RESERVATIONS:      z.string().url(),
  DATABASE_URL_FLOOR_PLAN:        z.string().url(),
  DATABASE_URL_KDS:               z.string().url(),
  DATABASE_URL_POS:               z.string().url(),
  DATABASE_URL_DELIVERY_DISPATCH: z.string().url(),

  // Cross-container HTTP base URLs. Restaurant modules occasionally need to
  // call platform-core (auth/users) or platform-marketplace (orders/inventory).
  PLATFORM_CORE_URL:              z.string().url().default('http://platform-core:3000'),
  PLATFORM_MARKETPLACE_URL:       z.string().url().default('http://platform-marketplace:3100'),
})

const parsed = envSchema.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid environment variables for platform-restaurant:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
