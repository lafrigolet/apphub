import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV:               z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL:           z.string().url(),
  MIGRATION_DATABASE_URL: z.string().url().optional(),
  REDIS_URL:              z.string().url(),
  EXPECTED_APP_ID:        z.string().default('platform'),
  LOG_LEVEL:              z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  // EasyPost fallback for local/dev — production resolves from the encrypted
  // easypost_api_key in platform_shipping.settings.
  EASYPOST_API_KEY:       z.string().optional(),
  // S3/MinIO for archiving carrier label PDFs — same values the storage module
  // reads (both live in platform-core). Optional: absent in tests/dev → labels
  // still purchase, we just keep the carrier-hosted URL without an archived copy.
  S3_ENDPOINT:            z.string().url().optional(),
  S3_REGION:              z.string().default('us-east-1'),
  S3_ACCESS_KEY:          z.string().optional(),
  S3_SECRET_KEY:          z.string().optional(),
  S3_BUCKET:              z.string().default('apphub'),
  S3_FORCE_PATH_STYLE:    z.coerce.boolean().default(true),
})

const parsed = envSchema.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid env for platform-shipping:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
