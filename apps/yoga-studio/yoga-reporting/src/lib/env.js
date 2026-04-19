import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  YOGA_REPORTING_PORT: z.coerce.number().default(3017),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  YOGA_JWT_SECRET: z.string().min(32),
  YOGA_TENANT_ID: z.string().uuid(),
  YOGA_SUB_TENANT_ID: z.string().uuid().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid environment variables:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
