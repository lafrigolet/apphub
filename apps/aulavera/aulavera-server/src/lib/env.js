import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV:               z.enum(['development', 'test', 'production']).default('development'),
  PORT:                   z.coerce.number().default(3031),
  // Opcional desde ADR 018: hospedado en apps-servers el Pool lo inyecta el
  // orquestador (DATABASE_URL_AULAVERA); solo el modo standalone lo necesita.
  DATABASE_URL:           z.string().url().optional(),
  MIGRATION_DATABASE_URL: z.string().url().optional(),
  REDIS_URL:              z.string().url(),
  PLATFORM_JWT_SECRET:    z.string().min(32),
  EXPECTED_APP_ID:        z.string().default('aulavera'),
  LOG_LEVEL:              z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Loopbacks al platform-core para donations / leads / storage. Mismo
  // host en la red docker; env separados por claridad de intención.
  PLATFORM_CORE_URL:      z.string().url().default('http://platform-core:3000'),
  AULAVERA_PUBLIC_URL:    z.string().url().optional(),
})

const parsed = envSchema.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid environment variables:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
