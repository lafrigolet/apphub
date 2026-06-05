import { z } from 'zod'
const envSchema = z.object({
  NODE_ENV:             z.enum(['development', 'test', 'production']).default('development'),
  PORT:                 z.coerce.number().default(3002),
  DATABASE_URL:         z.string().url(),
  MIGRATION_DATABASE_URL: z.string().url().optional(),
  REDIS_URL:            z.string().url(),
  EXPECTED_APP_ID:      z.string().default('platform'),
  LOG_LEVEL:            z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  RESEND_API_KEY:       z.string().optional(),
  EMAIL_FROM_ADDRESS:   z.string().email().optional(),
  // S3/MinIO for inbound attachments — same values the storage module reads
  // (both modules live in the platform-core container). Optional: absent in
  // tests/dev → attachment bytes are skipped, metadata still recorded.
  S3_ENDPOINT:          z.string().url().optional(),
  S3_REGION:            z.string().default('us-east-1'),
  S3_ACCESS_KEY:        z.string().optional(),
  S3_SECRET_KEY:        z.string().optional(),
  S3_BUCKET:            z.string().default('apphub'),
  S3_FORCE_PATH_STYLE:  z.coerce.boolean().default(true),
})
const parsed = envSchema.safeParse(process.env)
if (!parsed.success) { console.error(parsed.error.flatten().fieldErrors); process.exit(1) }
export const env = parsed.data
