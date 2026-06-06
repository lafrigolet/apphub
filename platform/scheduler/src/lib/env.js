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
  JOB_SCHEDULER_RUNS_PURGE_ENABLED:            z.coerce.boolean().default(true),
  JOB_AUTH_TOKEN_PURGE_ENABLED:                z.coerce.boolean().default(true),
  JOB_NOTIFICATION_SEND_LOG_PURGE_ENABLED:     z.coerce.boolean().default(true),
  JOB_NOTIFICATIONS_INBOUND_PURGE_ENABLED:     z.coerce.boolean().default(true),
  JOB_MESSAGING_SLA_ENABLED:                   z.coerce.boolean().default(true),
  JOB_TELEHEALTH_EXPIRE_STALE_ENABLED:         z.coerce.boolean().default(true),
  JOB_TPV_SESSION_AUTOCLOSE_ENABLED:           z.coerce.boolean().default(true),

  // GDPR — días que se conservan los leads cerrados (won/lost/closed) sin
  // actividad antes de purgarlos. 1095 = 3 años (plazo prudencial LOPDGDD).
  LEADS_RETENTION_DAYS:                        z.coerce.number().int().positive().default(1095),

  // Retención de la tabla de auditoría del propio scheduler (runs). 90 días.
  SCHEDULER_RUNS_RETENTION_DAYS:               z.coerce.number().int().positive().default(90),
  // Retención del send_log de notifications. 90 días.
  NOTIFICATIONS_SEND_LOG_RETENTION_DAYS:       z.coerce.number().int().positive().default(90),
  NOTIFICATIONS_INBOUND_RETENTION_DAYS:        z.coerce.number().int().positive().default(365),
  // SLA de primera respuesta del vendor en messaging buyer↔vendor. 24h.
  MESSAGING_SLA_HOURS:                         z.coerce.number().int().positive().default(24),

  // Bloque A — dead-man switch / reintentos con backoff en el jobRunner.
  // Nº de reintentos ante fallo del run antes de registrar status='error'.
  JOB_MAX_RETRIES:                             z.coerce.number().int().nonnegative().default(0),
  // Backoff base (ms) — el delay del intento n es JOB_RETRY_BACKOFF_MS * 2^(n-1).
  JOB_RETRY_BACKOFF_MS:                        z.coerce.number().int().nonnegative().default(500),
})

const parsed = envSchema.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid environment variables for platform-scheduler:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
