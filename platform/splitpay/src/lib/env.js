import { z } from 'zod'

// Treat empty strings the same as unset — `${VAR:-}` in docker-compose
// produces an empty value when the host env var is undefined, which
// would otherwise fail the .startsWith() check below.
const emptyToUndefined = (v) => (v === '' ? undefined : v)

const envSchema = z.object({
  NODE_ENV:                          z.enum(['development', 'test', 'production']).default('development'),
  PORT:                              z.coerce.number().default(3020),
  DATABASE_URL:                      z.string().url(),
  MIGRATION_DATABASE_URL:            z.string().url().optional(),
  REDIS_URL:                         z.string().url(),
  // Stripe credentials are now optional in env — they can also live in
  // splitpay_core.config (managed via console). At least ONE source
  // must provide them at runtime, but env-only deployments still work.
  SPLITPAY_STRIPE_SECRET_KEY:        z.preprocess(emptyToUndefined, z.string().startsWith('sk_').optional()),
  SPLITPAY_STRIPE_WEBHOOK_SECRET:    z.preprocess(emptyToUndefined, z.string().startsWith('whsec_').optional()),
  SPLITPAY_STRIPE_PUBLISHABLE_KEY:   z.preprocess(emptyToUndefined, z.string().startsWith('pk_').optional()),
  SPLITPAY_STRIPE_PLATFORM_ACCOUNT_ID: z.preprocess(emptyToUndefined, z.string().startsWith('acct_').optional()),
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
