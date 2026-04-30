import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV:               z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL:           z.string().url(),
  MIGRATION_DATABASE_URL: z.string().url().optional(),
  REDIS_URL:              z.string().url(),
  EXPECTED_APP_ID:        z.string().default('platform'),
  LOG_LEVEL:              z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),

  // S3-compatible store
  S3_ENDPOINT:         z.string().url(),
  S3_REGION:           z.string().default('us-east-1'),
  S3_ACCESS_KEY:       z.string(),
  S3_SECRET_KEY:       z.string(),
  S3_BUCKET:           z.string().default('apphub'),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  // Public-facing endpoint baked into presigned URLs (browser uses this).
  // Defaults to S3_ENDPOINT — set differently when the S3 service is reached
  // by the browser via a different host than by the Node service.
  S3_PUBLIC_ENDPOINT:  z.string().url().optional(),
})

const parsed = envSchema.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid env for @apphub/platform-storage:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
