import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV:               z.enum(['development', 'test', 'production']).default('development'),
  PLATFORM_TPV_PORT:      z.coerce.number().default(3500),
  MIGRATION_DATABASE_URL: z.string().url().optional(),
  REDIS_URL:              z.string().url().optional(),
  PLATFORM_JWT_SECRET:    z.string().min(32).optional(),
  EXPECTED_APP_ID:        z.string().default('platform'),
  LOG_LEVEL:              z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  ALLOWED_ORIGINS:        z.string().optional(),

  // Pool del módulo, ligado a su rol dedicado svc_platform_tpv.
  DATABASE_URL_TPV:       z.string().url().optional(),
  // Fallback genérico (tests / ejecución standalone del módulo).
  DATABASE_URL:           z.string().url().optional(),
})

const parsed = envSchema.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid environment variables for platform-tpv:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
