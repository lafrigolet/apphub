import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV:                          z.enum(['development', 'test', 'production']).default('development'),
  PLATFORM_APPOINTMENTS_PORT:        z.coerce.number().default(3300),
  MIGRATION_DATABASE_URL:            z.string().url(),
  REDIS_URL:                         z.string().url(),
  PLATFORM_JWT_SECRET:               z.string().min(32),
  EXPECTED_APP_ID:                   z.string().default('platform'),
  LOG_LEVEL:                         z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  ALLOWED_ORIGINS:                   z.string().optional(),

  // Per-module DATABASE_URLs — one Pool per module, each bound to its dedicated role.
  DATABASE_URL_SERVICES:             z.string().url(),
  DATABASE_URL_RESOURCES:            z.string().url(),
  DATABASE_URL_BOOKINGS:             z.string().url(),
  DATABASE_URL_AVAILABILITY:         z.string().url(),
  DATABASE_URL_INTAKE_FORMS:         z.string().url(),
  DATABASE_URL_TELEHEALTH:           z.string().url(),
  DATABASE_URL_PACKAGES:             z.string().url(),
  DATABASE_URL_PRACTITIONER_PAYOUTS: z.string().url(),

  // Cross-container HTTP base URLs.
  PLATFORM_CORE_URL:                 z.string().url().default('http://platform-core:3000'),
  PLATFORM_MARKETPLACE_URL:          z.string().url().default('http://platform-marketplace:3100'),
})

const parsed = envSchema.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid environment variables for platform-appointments:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
