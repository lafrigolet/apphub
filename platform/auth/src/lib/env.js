import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV:              z.enum(['development', 'test', 'production']).default('development'),
  PLATFORM_AUTH_PORT:   z.coerce.number().default(3000),
  DATABASE_URL:         z.string().url(),
  MIGRATION_DATABASE_URL: z.string().url().optional(),
  REDIS_URL:            z.string().url(),
  PLATFORM_JWT_SECRET:  z.string().min(32),
  PLATFORM_JWT_REFRESH_DAYS: z.coerce.number().default(90),
  EXPECTED_APP_ID:      z.string().default('platform'),
  LOG_LEVEL:            z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  GOOGLE_CLIENT_ID:     z.string().optional(),
  FACEBOOK_APP_ID:      z.string().optional(),
  FACEBOOK_APP_SECRET:  z.string().optional(),
})

const parsed = envSchema.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid environment variables:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
