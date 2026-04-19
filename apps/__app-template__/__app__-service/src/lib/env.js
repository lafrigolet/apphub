import { z } from 'zod'

// STEP: rename __APP__ prefix, set default PORT to next available (3030+)
const envSchema = z.object({
  NODE_ENV:        z.enum(['development', 'test', 'production']).default('development'),
  PORT:            z.coerce.number().default(3030),
  DATABASE_URL:    z.string().url(),
  REDIS_URL:       z.string().url(),
  PLATFORM_JWT_SECRET: z.string().min(32),
  EXPECTED_APP_ID: z.string().default('__app__'),
  LOG_LEVEL:       z.enum(['debug', 'info', 'warn', 'error']).default('info'),
})

const parsed = envSchema.safeParse(process.env)
if (!parsed.success) {
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
