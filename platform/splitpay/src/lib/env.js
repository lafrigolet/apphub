import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV:                          z.enum(['development', 'test', 'production']).default('development'),
  PORT:                              z.coerce.number().default(3020),
  DATABASE_URL:                      z.string().url(),
  MIGRATION_DATABASE_URL:            z.string().url().optional(),
  REDIS_URL:                         z.string().url(),
  SPLITPAY_STRIPE_SECRET_KEY:        z.string().startsWith('sk_'),
  SPLITPAY_STRIPE_WEBHOOK_SECRET:    z.string().startsWith('whsec_'),
  SPLITPAY_STRIPE_PUBLISHABLE_KEY:   z.string().startsWith('pk_'),
  SPLITPAY_STRIPE_PLATFORM_ACCOUNT_ID: z.string().startsWith('acct_').optional(),
  PLATFORM_JWT_SECRET:               z.string().min(32),
  EXPECTED_APP_ID:                   z.string().default('split-pay'),
  LOG_LEVEL:                         z.enum(['debug', 'info', 'warn', 'error']).default('info'),
})

const parsed = envSchema.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid environment variables:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
