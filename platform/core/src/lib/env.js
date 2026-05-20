import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV:                  z.enum(['development', 'test', 'production']).default('development'),
  PLATFORM_CORE_PORT:        z.coerce.number().default(3000),
  MIGRATION_DATABASE_URL:    z.string().url(),
  REDIS_URL:                 z.string().url(),
  PLATFORM_JWT_SECRET:       z.string().min(32),
  PLATFORM_JWT_REFRESH_DAYS: z.coerce.number().default(30),
  EXPECTED_APP_ID:           z.string().default('platform'),
  LOG_LEVEL:                 z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  ALLOWED_ORIGINS:           z.string().optional(),

  // Per-module DATABASE_URLs — one Pool per module, each bound to its dedicated role.
  DATABASE_URL_AUTH:           z.string().url(),
  DATABASE_URL_NOTIFICATIONS:  z.string().url(),
  DATABASE_URL_PAYMENTS:       z.string().url(),
  DATABASE_URL_TENANT_CONFIG:  z.string().url(),
  DATABASE_URL_SPLITPAY:       z.string().url(),
  DATABASE_URL_STORAGE:        z.string().url(),
  DATABASE_URL_LEADS:          z.string().url(),
  DATABASE_URL_DONATIONS:      z.string().url(),

  // Storage module — S3-compatible object store (MinIO in dev, AWS S3/R2 in prod)
  S3_ENDPOINT:         z.string().url(),
  S3_REGION:           z.string().default('us-east-1'),
  S3_ACCESS_KEY:       z.string(),
  S3_SECRET_KEY:       z.string(),
  S3_BUCKET:           z.string().default('apphub'),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  S3_PUBLIC_ENDPOINT:  z.string().url().optional(),

  // OAuth credentials forwarded to the auth module
  GOOGLE_CLIENT_ID:          z.string().optional(),
  FACEBOOK_APP_ID:           z.string().optional(),
  FACEBOOK_APP_SECRET:       z.string().optional(),

  // Notifications module — Resend ESP
  RESEND_API_KEY:            z.string().optional(),
  EMAIL_FROM_ADDRESS:        z.string().email().optional(),

  // Payments module — Stripe
  PLATFORM_STRIPE_SECRET_KEY:     z.string().optional(),
  PLATFORM_STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // Splitpay module — Stripe Connect (validated by splitpay's own env.js)
  SPLITPAY_STRIPE_SECRET_KEY:          z.string().optional(),
  SPLITPAY_STRIPE_WEBHOOK_SECRET:      z.string().optional(),
  SPLITPAY_STRIPE_PUBLISHABLE_KEY:     z.string().optional(),
  SPLITPAY_STRIPE_PLATFORM_ACCOUNT_ID: z.string().optional(),
})

const parsed = envSchema.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid environment variables for platform-core:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
