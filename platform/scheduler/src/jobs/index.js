import * as availabilityHoldPurge        from './availability-hold-purge.job.js'
import * as bookingReminders               from './booking-reminders.job.js'
import * as bookingRecurrenceExpander      from './booking-recurrence-expander.job.js'
import * as reservationReminders           from './reservation-reminders.job.js'
import * as packageExpiryWarning           from './package-expiry-warning.job.js'
import * as packageExpiryTransition        from './package-expiry-transition.job.js'
import * as practitionerPayoutClose        from './practitioner-payout-close.job.js'
import * as disputeSla                     from './dispute-sla.job.js'
import * as basketAbandoned                from './basket-abandoned.job.js'
import * as storageOrphanPurge              from './storage-orphan-purge.job.js'
import * as storageRetentionPurge           from './storage-retention-purge.job.js'
import * as notificationDigest               from './notification-digest.job.js'
import * as chatScheduledSend                from './chat-scheduled-send.job.js'
import * as chatEphemeralPurge               from './chat-ephemeral-purge.job.js'
import * as chatRetentionPurge               from './chat-retention-purge.job.js'
import * as chatSupportSla                   from './chat-support-sla.job.js'
import * as leadRetentionPurge               from './lead-retention-purge.job.js'
import * as schedulerRunsPurge               from './scheduler-runs-purge.job.js'
import * as authTokenPurge                    from './auth-token-purge.job.js'
import * as notificationSendLogPurge          from './notification-send-log-purge.job.js'
import * as messagingSla                       from './messaging-sla.job.js'
import * as telehealthExpireStale              from './telehealth-expire-stale.job.js'
import * as tpvSessionAutoclose                from './tpv-session-autoclose.job.js'

import { env } from '../lib/env.js'

// Each job declares its own name + cron expression in its `meta` export. The
// orchestrator reads `enabled` from env to flip individual jobs at deploy
// time without code changes.
export const jobs = [
  { mod: availabilityHoldPurge,      enabled: env.JOB_AVAILABILITY_HOLD_PURGE_ENABLED },
  { mod: bookingReminders,            enabled: env.JOB_BOOKING_REMINDERS_ENABLED },
  { mod: bookingRecurrenceExpander,   enabled: env.JOB_BOOKING_RECURRENCE_EXPANDER_ENABLED },
  { mod: reservationReminders,        enabled: env.JOB_RESERVATION_REMINDERS_ENABLED },
  { mod: packageExpiryWarning,        enabled: env.JOB_PACKAGE_EXPIRY_WARNING_ENABLED },
  { mod: packageExpiryTransition,     enabled: env.JOB_PACKAGE_EXPIRY_TRANSITION_ENABLED },
  { mod: practitionerPayoutClose,     enabled: env.JOB_PRACTITIONER_PAYOUT_CLOSE_ENABLED },
  { mod: disputeSla,                  enabled: env.JOB_DISPUTE_SLA_ENABLED },
  { mod: basketAbandoned,             enabled: env.JOB_BASKET_ABANDONED_ENABLED },
  { mod: storageOrphanPurge,          enabled: env.JOB_STORAGE_ORPHAN_PURGE_ENABLED },
  { mod: storageRetentionPurge,       enabled: env.JOB_STORAGE_RETENTION_PURGE_ENABLED },
  { mod: notificationDigest,           enabled: env.JOB_NOTIFICATION_DIGEST_ENABLED },
  { mod: chatScheduledSend,            enabled: env.JOB_CHAT_SCHEDULED_SEND_ENABLED },
  { mod: chatEphemeralPurge,           enabled: env.JOB_CHAT_EPHEMERAL_PURGE_ENABLED },
  { mod: chatRetentionPurge,           enabled: env.JOB_CHAT_RETENTION_PURGE_ENABLED },
  { mod: chatSupportSla,               enabled: env.JOB_CHAT_SUPPORT_SLA_ENABLED },
  { mod: leadRetentionPurge,           enabled: env.JOB_LEAD_RETENTION_PURGE_ENABLED },
  { mod: schedulerRunsPurge,           enabled: env.JOB_SCHEDULER_RUNS_PURGE_ENABLED },
  { mod: authTokenPurge,               enabled: env.JOB_AUTH_TOKEN_PURGE_ENABLED },
  { mod: notificationSendLogPurge,     enabled: env.JOB_NOTIFICATION_SEND_LOG_PURGE_ENABLED },
  { mod: messagingSla,                 enabled: env.JOB_MESSAGING_SLA_ENABLED },
  { mod: telehealthExpireStale,        enabled: env.JOB_TELEHEALTH_EXPIRE_STALE_ENABLED },
  { mod: tpvSessionAutoclose,          enabled: env.JOB_TPV_SESSION_AUTOCLOSE_ENABLED },
].map((j) => ({
  meta:    j.mod.meta,
  run:     j.mod.run,
  enabled: j.enabled,
}))
