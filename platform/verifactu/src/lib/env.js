import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV:               z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL:           z.string().url(),
  MIGRATION_DATABASE_URL: z.string().url().optional(),
  LOG_LEVEL:              z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
})

const parsed = envSchema.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid environment variables for platform-verifactu:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
