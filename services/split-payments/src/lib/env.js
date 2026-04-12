import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PAYMENTS_PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  PAYMENTS_STRIPE_SECRET_KEY: z.string().startsWith('sk_'),
  PAYMENTS_STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_'),
  PAYMENTS_STRIPE_PUBLISHABLE_KEY: z.string().startsWith('pk_'),
  PAYMENTS_STRIPE_PLATFORM_ACCOUNT_ID: z.string().startsWith('acct_').optional(),
  JWT_SECRET: z.string().min(32),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('❌ Invalid environment variables:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
