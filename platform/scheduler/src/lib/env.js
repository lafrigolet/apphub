import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV:                  z.enum(['development', 'test', 'production']).default('development'),
  PLATFORM_SCHEDULER_PORT:   z.coerce.number().default(3400),
  DATABASE_URL:              z.string().url(),  // svc_platform_scheduler — own runs table + cross-schema reads
  MIGRATION_DATABASE_URL:    z.string().url(),
  REDIS_URL:                 z.string().url(),
  PLATFORM_JWT_SECRET:       z.string().min(32),
  EXPECTED_APP_ID:           z.string().default('platform'),
  LOG_LEVEL:                 z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),

  // Feature flags — turn individual jobs on/off without redeploying.
  JOB_AVAILABILITY_HOLD_PURGE_ENABLED:        z.coerce.boolean().default(true),
  JOB_BOOKING_REMINDERS_ENABLED:              z.coerce.boolean().default(true),
  JOB_BOOKING_RECURRENCE_EXPANDER_ENABLED:    z.coerce.boolean().default(true),
  JOB_RESERVATION_REMINDERS_ENABLED:          z.coerce.boolean().default(true),
  JOB_PACKAGE_EXPIRY_WARNING_ENABLED:         z.coerce.boolean().default(true),
  JOB_PACKAGE_EXPIRY_TRANSITION_ENABLED:      z.coerce.boolean().default(true),
  JOB_PRACTITIONER_PAYOUT_CLOSE_ENABLED:      z.coerce.boolean().default(true),
  JOB_DISPUTE_SLA_ENABLED:                    z.coerce.boolean().default(true),
  JOB_BASKET_ABANDONED_ENABLED:               z.coerce.boolean().default(true),
  JOB_STORAGE_ORPHAN_PURGE_ENABLED:           z.coerce.boolean().default(true),
  JOB_STORAGE_RETENTION_PURGE_ENABLED:        z.coerce.boolean().default(true),
  JOB_NOTIFICATION_DIGEST_ENABLED:             z.coerce.boolean().default(true),
  JOB_CHAT_SCHEDULED_SEND_ENABLED:             z.coerce.boolean().default(true),
  JOB_CHAT_EPHEMERAL_PURGE_ENABLED:            z.coerce.boolean().default(true),
  JOB_CHAT_RETENTION_PURGE_ENABLED:            z.coerce.boolean().default(true),
  JOB_CHAT_SUPPORT_SLA_ENABLED:                z.coerce.boolean().default(true),
  JOB_LEAD_RETENTION_PURGE_ENABLED:            z.coerce.boolean().default(true),

  // GDPR — días que se conservan los leads cerrados (won/lost/closed) sin
  // actividad antes de purgarlos. 1095 = 3 años (plazo prudencial LOPDGDD).
  LEADS_RETENTION_DAYS:                        z.coerce.number().int().positive().default(1095),
})

const parsed = envSchema.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid environment variables for platform-scheduler:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
