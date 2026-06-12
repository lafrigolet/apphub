import Redis from 'ioredis'
import { env } from '../lib/env.js'
import { logger } from '../lib/logger.js'
import {
  sendWelcomeEmail, sendPasswordResetEmail,
  sendBookingReminderEmail, sendReservationReminderEmail,
  sendPackageExpiryEmail, sendDisputeSlaInternalEmail, sendLeadSlaInternalEmail,
  sendBookingConfirmedEmail, sendBookingCancelledEmail, sendBookingRescheduledEmail,
  sendReservationCreatedEmail, sendReservationCancelledEmail,
  sendPackageExhaustedEmail, sendPayoutPaidEmail,
} from './email.service.js'
import {
  sendBookingReminderSms, sendReservationReminderSms,
  sendBookingConfirmedSms, sendBookingCancelledSms, sendBookingRescheduledSms,
  sendReservationCancelledSms,
  sendWaitlistNotifiedSms, sendBookingWaitlistNotifiedSms,
} from './sms.service.js'
import { checkRateLimit } from './rate-limit.service.js'
import { claimEvent } from './idempotency.service.js'
import { isMuted } from './preferences.service.js'
import { shouldDigest, enqueueDigest } from './digest.service.js'
import {
  sendBookingReminderPush, sendBookingConfirmedPush, sendReservationReminderPush,
  sendPushToUser,
  sendReviewRepliedPush, sendDisputeOpenedPush, sendDisputeWithdrawnPush,
  sendPackageFrozenPush, sendPackageUnfrozenPush, sendPackageRefundedPush,
} from './push.service.js'

// Rate-limit + preference gate: skip the send when the user opted out of this
// channel/category, or when the per-user/hour or per-user/day cap is hit. We
// only check when userId is present — staff/system messages bypass both gates
// (anonymous initiators have no preference row and no per-user limit).
async function gated(userId, eventClass, channel, fn, ctx) {
  if (userId) {
    // Preference opt-out takes precedence over rate-limit: a muted channel
    // shouldn't even consume a rate-limit slot. Tenant context (when present
    // on the event payload) lets the RLS-scoped lookup run; otherwise the
    // preference check fails open and only the rate-limit applies.
    const muted = await isMuted({
      userId, eventType: eventClass, channel,
      appId: ctx?.appId, tenantId: ctx?.tenantId, subTenantId: ctx?.subTenantId,
    })
    if (muted) {
      logger.info({ userId, eventClass, channel }, 'notification suppressed by user preference')
      return
    }
    const v = await checkRateLimit({ userId, eventClass, channel })
    if (!v.allowed) {
      logger.info({ userId, eventClass, channel, reason: v.reason }, 'notification suppressed by rate-limit')
      return
    }
  }
  await fn()
}

// Email-only digest hook. Returns true when the event was buffered (and the
// caller should NOT send immediately); false when the caller should proceed
// with the immediate send. SMS bypasses the digest by design — text messages
// are usually time-sensitive and digesting them defeats the channel's value.
async function maybeDigestEmail(event, { userId, to, locale }) {
  if (!userId || !to) return false
  if (!(await shouldDigest(event.type))) return false
  await enqueueDigest({ userId, eventType: event.type, payload: event.payload, locale, to })
  return true
}

export function startEventConsumer() {
  const sub = new Redis(env.REDIS_URL)

  sub.ready = new Promise((resolve, reject) => {
    sub.subscribe('platform.events', (err) => {
      if (err) { logger.error({ err }, 'Failed to subscribe to platform.events'); reject(err) }
      else { logger.info('platform-notifications subscribed to platform.events'); resolve() }
    })
  })


  sub.on('message', async (_channel, message) => {
    let event
    try {
      event = JSON.parse(message)
    } catch {
      return
    }

    try {
      // Idempotency: drop redelivered events (producer retry, Redis reconnect
      // replay, manual re-publish) before any send. The internal digest-flush
      // is deliberately exempt — it's safe to run repeatedly (it renames the
      // per-user queue before reading) and the scheduler may fire it on a tight
      // cadence that we must never dedup away.
      if (event.type !== 'notifications.digest.flush') {
        if (!(await claimEvent(event))) return
      }

      // Locale is optional on every event payload. Senders default to 'es'
      // when missing, and the template repo falls back to 'es' rows when the
      // requested locale has no row — so an unknown/missing locale never
      // breaks delivery.
      const locale = event.payload?.locale ?? 'es'

      // Tenant context for the RLS-scoped preference lookup, when the producer
      // included it on the payload. Events without it fall back to fail-open.
      const prefCtx = {
        appId:       event.payload?.appId ?? null,
        tenantId:    event.payload?.tenantId ?? null,
        subTenantId: event.payload?.subTenantId ?? null,
      }

      if (event.type === 'user.registered') {
        const { email, appId, userId } = event.payload ?? {}
        if (email) await gated(userId, event.type, 'email', () => sendWelcomeEmail(email, appId, locale))
      }

      if (event.type === 'auth.password_reset_requested') {
        const { email, token, userId, appId } = event.payload ?? {}
        if (email && token) {
          // Cada app tiene su propio subdomain (aikikan.hulkstein.com, splitpay.hulkstein.com, …).
          // Por convención subdomain === appId (platform_tenants.apps.subdomain coincide con app_id).
          // En prod resolvemos a https://<appId>.<PLATFORM_PUBLIC_DOMAIN>; en dev caemos a
          // http://<appId>.hulkstein.local:8080 (mismo nginx local).
          const subdomain    = event.payload.subdomain ?? appId
          const publicDomain = process.env.PLATFORM_PUBLIC_DOMAIN
          const base = subdomain && publicDomain
            ? `https://${subdomain}.${publicDomain}`
            : subdomain
              ? `http://${subdomain}.hulkstein.local:8080`
              : 'http://hulkstein.local:8080'
          const resetUrl = `${base}/reset-password?token=${token}`
          await gated(userId, event.type, 'email', () => sendPasswordResetEmail(email, resetUrl, locale))
        }
      }

      // ── Magic-link passwordless (A8) ─────────────────────────────────
      if (event.type === 'auth.magic_link_blocked_pending_approval') {
        const { email, displayName, userId } = event.payload ?? {}
        if (email) {
          const { sendMagicLinkPendingApprovalEmail } = await import('./email.service.js')
          await gated(userId, event.type, 'email', () => sendMagicLinkPendingApprovalEmail(email, { displayName, locale }))
        }
      }
      if (event.type === 'auth.magic_link_requested') {
        const { email, displayName, token, userId, appId } = event.payload ?? {}
        if (email && token) {
          const subdomain    = event.payload.subdomain ?? appId
          const publicDomain = process.env.PLATFORM_PUBLIC_DOMAIN
          const base = subdomain && publicDomain
            ? `https://${subdomain}.${publicDomain}`
            : subdomain
              ? `http://${subdomain}.hulkstein.local:8080`
              : 'http://hulkstein.local:8080'
          const magicLinkUrl = `${base}/magic-login?token=${token}`
          const { sendMagicLinkEmail } = await import('./email.service.js')
          await gated(userId, event.type, 'email', () => sendMagicLinkEmail(email, { displayName, magicLinkUrl, locale }))
        }
      }

      // ── Donaciones (platform/donations) ──────────────────────────────
      if (event.type === 'donation.completed') {
        const { donorEmail, donorName, amountCents, causeId, userId, kind } = event.payload ?? {}
        if (donorEmail && kind === 'one_shot') {
          const { sendDonationThankYou } = await import('./email.service.js')
          await gated(userId ?? null, event.type, 'email',
            () => sendDonationThankYou(donorEmail, { donorName, amountCents, causeName: null, locale }))
        }
        // El primer cobro de una recurring también pasa por aquí; lo
        // mandamos como thank_you (es el "te has suscrito, gracias").
        if (donorEmail && kind === 'recurring_monthly') {
          const { sendDonationThankYou } = await import('./email.service.js')
          await gated(userId ?? null, event.type, 'email',
            () => sendDonationThankYou(donorEmail, { donorName, amountCents, causeName: null, locale }))
        }
      }
      if (event.type === 'donation.recurring.charged') {
        const { donorEmail, donorName, amountCents, userId } = event.payload ?? {}
        if (donorEmail) {
          const { sendDonationMonthlyReceipt } = await import('./email.service.js')
          await gated(userId ?? null, event.type, 'email',
            () => sendDonationMonthlyReceipt(donorEmail, { donorName, amountCents, causeName: null, locale }))
        }
      }
      if (event.type === 'donation.recurring.failed') {
        const { donorEmail, donorName, userId } = event.payload ?? {}
        if (donorEmail) {
          const { sendDonationPaymentFailed } = await import('./email.service.js')
          await gated(userId ?? null, event.type, 'email',
            () => sendDonationPaymentFailed(donorEmail, { donorName, amountCents: 0, locale }))
        }
      }
      if (event.type === 'donation.recurring.cancelled') {
        const { donorEmail, donorName, userId } = event.payload ?? {}
        if (donorEmail) {
          const { sendDonationCancelled } = await import('./email.service.js')
          await gated(userId ?? null, event.type, 'email',
            () => sendDonationCancelled(donorEmail, { donorName, locale }))
        }
      }
      if (event.type === 'donation.refunded') {
        const { donorEmail, donorName, amountCents, userId } = event.payload ?? {}
        if (donorEmail) {
          const { sendDonationRefunded } = await import('./email.service.js')
          await gated(userId ?? null, event.type, 'email',
            () => sendDonationRefunded(donorEmail, { donorName, amountCents, locale }))
        }
      }
      if (event.type === 'donation.certificate.ready') {
        const { donorEmail, donorName, fiscalYear, certificateUrl, userId } = event.payload ?? {}
        if (donorEmail && certificateUrl) {
          const { sendDonationCertificateReady } = await import('./email.service.js')
          await gated(userId ?? null, event.type, 'email',
            () => sendDonationCertificateReady(donorEmail, { donorName, year: fiscalYear, certificateUrl, locale }))
        }
      }

      // ── Inquiries (platform/inquiries) ───────────────────────────────
      // Form de contacto. 2 emails por consulta:
      //   1) admin alert al contact_inbox_email del tenant (Reply-To = email user)
      //   2) "gracias" al user (Reply-To = inbox del admin)
      // NO se gatea con rate-limit per-user porque el initiator es anónimo
      // y el inbox del admin no es un user; send() directo.
      if (event.type === 'inquiry.created') {
        const {
          contactInboxEmail, email, contactName, phone, subject, message,
          reference, replyToEmail, inquiryId, appId, tenantId,
        } = event.payload ?? {}
        const { sendInquiryAdminAlert, sendInquiryUserThankYou } = await import('./email.service.js')
        if (contactInboxEmail) {
          try {
            await sendInquiryAdminAlert(contactInboxEmail, {
              contactName, email, phone, subject, message, reference,
            }, locale)
          } catch (err) {
            logger.error({ err, reference }, 'sendInquiryAdminAlert failed')
          }
        }
        if (email) {
          // Inbound bridge (§26/§27): when receiving is enabled, the thank-you
          // email's Reply-To is a minted reply+<token> address — the user's
          // reply is re-ingested into the inquiry thread instead of dying in
          // the admin's personal inbox. Null (inbound off) keeps V1 behaviour.
          let replyToOverride = null
          if (inquiryId) {
            const { mintReplyAddress } = await import('./reply-address.service.js')
            replyToOverride = await mintReplyAddress({
              targetEvent: 'inquiry.reply.received',
              context: { inquiryId, reference, party: 'user', notifyEmail: contactInboxEmail ?? null, userEmail: email },
              appId: appId ?? null,
              tenantId: tenantId ?? null,
            })
          }
          try {
            await sendInquiryUserThankYou(email, {
              contactName, reference, contactInboxEmail, replyToEmail, replyToOverride,
            }, locale)
          } catch (err) {
            logger.error({ err, reference }, 'sendInquiryUserThankYou failed')
          }
        }
      }

      // Inbound bridge (§26): a user's email reply was captured and routed via
      // its reply token. The inquiries module appends it to the thread; here we
      // alert the tenant's admin inbox so the conversation keeps flowing.
      if (event.type === 'inquiry.reply.received') {
        const { context, from, fromName, text, rawText } = event.payload ?? {}
        const notifyEmail = context?.notifyEmail
        if (notifyEmail) {
          const { sendInquiryReplyAlert } = await import('./email.service.js')
          try {
            await sendInquiryReplyAlert(notifyEmail, {
              contactName: fromName, fromEmail: from,
              reference: context?.reference, message: text || rawText || '',
            }, locale)
          } catch (err) {
            logger.error({ err, reference: context?.reference }, 'sendInquiryReplyAlert failed')
          }
        }
      }

      // ── Leads (platform/leads) ───────────────────────────────────────
      // Auto-respuesta al prospecto: acuse inmediato del formulario de la
      // landing. Initiator anónimo (sin userId) → sin rate-limit gate, igual
      // que inquiry.created.
      if (event.type === 'lead.created') {
        const { email, contactName, leadId } = event.payload ?? {}
        if (email) {
          const { sendLeadAcknowledgementEmail } = await import('./email.service.js')
          try {
            await sendLeadAcknowledgementEmail(email, { contactName, locale })
          } catch (err) {
            logger.error({ err, leadId }, 'sendLeadAcknowledgementEmail failed')
          }
        }
      }

      // ── Leads — alertas internas a staff (use-cases §16) ─────────────
      // El owner se direcciona por PUSH (push_devices va por userId; leads no
      // guarda emails de staff — auth sí, igual que reviews/disputes). Las
      // alertas de equipo (sin owner, o SLA/estancado) van al buzón de ops
      // STAFF_OPS_EMAIL, mismo patrón que dispute.sla_breached. tenant_id es
      // null: los leads son globales (pre-tenant) y gated() falla-abierto.
      if (event.type === 'lead.assigned') {
        const { appId, leadId, assignedTo } = event.payload ?? {}
        if (assignedTo) {
          const ctx = { appId, tenantId: null, subTenantId: null, userId: assignedTo, role: 'system' }
          await gated(assignedTo, event.type, 'push', () => sendPushToUser(ctx, assignedTo, {
            title: 'Lead asignado', body: '', data: { type: 'lead.assigned', leadId },
          }))
        }
      }

      if (event.type === 'lead.followup.due') {
        const { appId, leadId, assignedTo } = event.payload ?? {}
        if (assignedTo) {
          const ctx = { appId, tenantId: null, subTenantId: null, userId: assignedTo, role: 'system' }
          await gated(assignedTo, event.type, 'push', () => sendPushToUser(ctx, assignedTo, {
            title: 'Seguimiento de lead pendiente', body: '', data: { type: 'lead.followup.due', leadId },
          }))
        } else if (process.env.STAFF_OPS_EMAIL) {
          // Sin comercial asignado → al buzón de ops, para que no se pierda.
          await sendLeadSlaInternalEmail(process.env.STAFF_OPS_EMAIL, { kind: 'followup', leadId, locale })
        }
      }

      if (event.type === 'lead.sla.uncontacted' || event.type === 'lead.stale') {
        const { appId, leadId, assignedTo, createdAt, slaHours, staleDays } = event.payload ?? {}
        const kind = event.type === 'lead.stale' ? 'stale' : 'uncontacted'
        if (process.env.STAFF_OPS_EMAIL) {
          await sendLeadSlaInternalEmail(process.env.STAFF_OPS_EMAIL, { kind, leadId, createdAt, slaHours, staleDays, locale })
        }
        if (assignedTo) {
          const ctx = { appId, tenantId: null, subTenantId: null, userId: assignedTo, role: 'system' }
          await gated(assignedTo, event.type, 'push', () => sendPushToUser(ctx, assignedTo, {
            title: kind === 'stale' ? 'Lead estancado' : 'Lead sin contactar', body: '', data: { type: event.type, leadId },
          }))
        }
      }

      // ── Self-register + Admin-approval (Ruta 1) ──────────────────────
      if (event.type === 'auth.signup.requested') {
        const { email, displayName, userId } = event.payload ?? {}
        if (email) {
          const { sendSignupRequestedEmail } = await import('./email.service.js')
          await gated(userId, event.type, 'email', () => sendSignupRequestedEmail(email, { displayName, locale }))
        }
      }
      if (event.type === 'auth.signup.approved') {
        const { email, displayName, token, userId, appId } = event.payload ?? {}
        if (email && token) {
          const subdomain    = event.payload.subdomain ?? appId
          const publicDomain = process.env.PLATFORM_PUBLIC_DOMAIN
          const base = subdomain && publicDomain
            ? `https://${subdomain}.${publicDomain}`
            : subdomain
              ? `http://${subdomain}.hulkstein.local:8080`
              : 'http://hulkstein.local:8080'
          const magicLinkUrl = `${base}/reset-password?token=${token}`
          const { sendSignupApprovedEmail } = await import('./email.service.js')
          await gated(userId, event.type, 'email', () => sendSignupApprovedEmail(email, { displayName, magicLinkUrl, locale }))
        }
      }
      if (event.type === 'auth.signup.rejected') {
        const { email, displayName, reason, userId } = event.payload ?? {}
        if (email) {
          const { sendSignupRejectedEmail } = await import('./email.service.js')
          await gated(userId, event.type, 'email', () => sendSignupRejectedEmail(email, { displayName, reason, locale }))
        }
      }

      // ── Tenant bootstrap (Fase A) ───────────────────────────────────
      // Producido por platform-tenant-config tras crear app+tenant+owner.
      // El payload incluye el magic-link ya compuesto (con el subdomain del
      // tenant) — notifications sólo se encarga de mandar el email.
      if (event.type === 'tenant.bootstrap_started') {
        const { ownerEmail, ownerDisplayName, magicLinkUrl, expiresAt, appDisplayName, tenantDisplayName } = event.payload ?? {}
        if (ownerEmail && magicLinkUrl) {
          const { sendTenantBootstrapEmail } = await import('./email.service.js')
          // No rate-limit: el email lo dispara staff manualmente y no hay userId aún.
          await sendTenantBootstrapEmail(ownerEmail, {
            ownerDisplayName, magicLinkUrl, expiresAt, appDisplayName, tenantDisplayName, locale,
          })
        }
      }

      // El owner consumió el magic-link y fijó password — bienvenida.
      if (event.type === 'tenant.activated') {
        const { ownerEmail } = event.payload ?? {}
        if (ownerEmail) {
          const { sendTenantActivatedEmail } = await import('./email.service.js')
          await sendTenantActivatedEmail(ownerEmail, { locale })
        }
      }

      // ── platform-scheduler events ────────────────────────────────────
      if (event.type === 'booking.reminder.due') {
        const { appId, tenantId, clientEmail, clientPhone, clientName, clientUserId, startsAt, window } = event.payload ?? {}
        const pushCtx = { appId, tenantId, subTenantId: null, userId: clientUserId, role: 'system' }
        if (clientEmail) await gated(clientUserId, event.type, 'email', () => sendBookingReminderEmail(clientEmail, { name: clientName, startsAt, window, locale }), prefCtx)
        // SMS goes out only when the scheduler hydrated the phone number;
        // the booking module is responsible for including it in the event
        // payload. Stays a noop in dev / when Twilio is not configured.
        if (clientPhone) await gated(clientUserId, event.type, 'sms', () => sendBookingReminderSms(clientPhone, { name: clientName, startsAt, window, locale }), prefCtx)
        if (clientUserId) await gated(clientUserId, event.type, 'push', () => sendBookingReminderPush(pushCtx, clientUserId, { startsAt, window, locale }), prefCtx)
      }

      if (event.type === 'reservation.reminder.due') {
        const { appId, tenantId, guestEmail, guestPhone, guestName, guestUserId, reservedFor, partySize, window } = event.payload ?? {}
        const pushCtx = { appId, tenantId, subTenantId: null, userId: guestUserId, role: 'system' }
        if (guestEmail) await gated(guestUserId, event.type, 'email', () => sendReservationReminderEmail(guestEmail, { name: guestName, reservedFor, partySize, window, locale }), prefCtx)
        if (guestPhone) await gated(guestUserId, event.type, 'sms',   () => sendReservationReminderSms(guestPhone, { name: guestName, reservedFor, partySize, window, locale }), prefCtx)
        if (guestUserId) await gated(guestUserId, event.type, 'push',  () => sendReservationReminderPush(pushCtx, guestUserId, { reservedFor, partySize, window, locale }), prefCtx)
      }

      if (event.type === 'package.expiring') {
        // The scheduler doesn't carry the user's email — clients should hydrate
        // it. For V1 we look it up via auth's user_id → email cache; falling
        // back to a noop if missing. This is a known limitation tracked in TODO.
        const { remainingSessions, expiresAt, window, clientEmail, clientUserId } = event.payload ?? {}
        if (clientEmail) await gated(clientUserId, event.type, 'email', () => sendPackageExpiryEmail(clientEmail, { remainingSessions, expiresAt, window, locale }))
      }

      if (event.type === 'dispute.sla_breached') {
        const staffEmail = process.env.STAFF_OPS_EMAIL
        if (staffEmail) {
          const { disputeId, orderId, openedAt } = event.payload ?? {}
          // Staff dispatch — bypass rate limit (same recipient, low volume).
          await sendDisputeSlaInternalEmail(staffEmail, { disputeId, orderId, openedAt, locale })
        }
      }

      // ── New event subscriptions ──────────────────────────────────────
      if (event.type === 'booking.confirmed' || event.type === 'booking.reminded') {
        const { appId, tenantId, clientEmail, clientPhone, clientName, clientUserId, startsAt } = event.payload ?? {}
        const pushCtx = { appId, tenantId, subTenantId: null, userId: clientUserId, role: 'system' }
        if (clientEmail && !await maybeDigestEmail(event, { userId: clientUserId, to: clientEmail, locale })) {
          await gated(clientUserId, event.type, 'email', () => sendBookingConfirmedEmail(clientEmail, { name: clientName, startsAt, locale }), prefCtx)
        }
        if (clientPhone) await gated(clientUserId, event.type, 'sms', () => sendBookingConfirmedSms(clientPhone, { startsAt, locale }), prefCtx)
        if (clientUserId) await gated(clientUserId, event.type, 'push', () => sendBookingConfirmedPush(pushCtx, clientUserId, { startsAt, locale }), prefCtx)
      }

      if (event.type === 'booking.cancelled') {
        const { clientEmail, clientPhone, clientName, clientUserId, startsAt, reason } = event.payload ?? {}
        if (clientEmail && !await maybeDigestEmail(event, { userId: clientUserId, to: clientEmail, locale })) {
          await gated(clientUserId, event.type, 'email', () => sendBookingCancelledEmail(clientEmail, { name: clientName, startsAt, reason, locale }))
        }
        if (clientPhone) await gated(clientUserId, event.type, 'sms', () => sendBookingCancelledSms(clientPhone, { startsAt, locale }))
      }

      if (event.type === 'booking.rescheduled') {
        const { clientEmail, clientPhone, clientName, clientUserId, startsAt } = event.payload ?? {}
        if (clientEmail && !await maybeDigestEmail(event, { userId: clientUserId, to: clientEmail, locale })) {
          await gated(clientUserId, event.type, 'email', () => sendBookingRescheduledEmail(clientEmail, { name: clientName, startsAt, locale }))
        }
        if (clientPhone) await gated(clientUserId, event.type, 'sms', () => sendBookingRescheduledSms(clientPhone, { startsAt, locale }))
      }

      if (event.type === 'reservation.created') {
        const { guestEmail, guestName, guestUserId, reservedFor, partySize } = event.payload ?? {}
        if (guestEmail && !await maybeDigestEmail(event, { userId: guestUserId, to: guestEmail, locale })) {
          await gated(guestUserId, event.type, 'email', () => sendReservationCreatedEmail(guestEmail, { name: guestName, reservedFor, partySize, locale }))
        }
      }

      if (event.type === 'reservation.cancelled') {
        const { guestEmail, guestPhone, guestName, guestUserId, reservedFor } = event.payload ?? {}
        if (guestEmail && !await maybeDigestEmail(event, { userId: guestUserId, to: guestEmail, locale })) {
          await gated(guestUserId, event.type, 'email', () => sendReservationCancelledEmail(guestEmail, { name: guestName, reservedFor, locale }))
        }
        if (guestPhone) await gated(guestUserId, event.type, 'sms', () => sendReservationCancelledSms(guestPhone, { reservedFor, locale }))
      }

      if (event.type === 'package.exhausted') {
        const { clientEmail, clientUserId } = event.payload ?? {}
        if (clientEmail && !await maybeDigestEmail(event, { userId: clientUserId, to: clientEmail, locale })) {
          await gated(clientUserId, event.type, 'email', () => sendPackageExhaustedEmail(clientEmail, { locale }))
        }
      }

      // Internal event published by platform-scheduler at the configured
      // cadence. Drains every per-user digest queue into one composed email
      // each. Idempotent under concurrent firings (renames the queue key
      // before reading).
      if (event.type === 'notifications.digest.flush') {
        const { flushAll } = await import('./digest.service.js')
        const { sendRaw }  = await import('./email.service.js')
        const result = await flushAll({ send: sendRaw, logger })
        logger.info(result, 'digest flushed')
      }

      // Inbound retention purge (§29) — published daily by platform-scheduler
      // (notifications-inbound-purge job). Rows + S3 objects + expired tokens.
      if (event.type === 'notifications.inbound.purge_due') {
        const { retentionDays } = event.payload ?? {}
        const { purgeInbound } = await import('./inbound.service.js')
        await purgeInbound(retentionDays)
      }

      if (event.type === 'payout.paid') {
        const { practitionerEmail, practitionerUserId, amount, periodLabel, externalRef } = event.payload ?? {}
        if (practitionerEmail && !await maybeDigestEmail(event, { userId: practitionerUserId, to: practitionerEmail, locale })) {
          await gated(practitionerUserId, event.type, 'email', () => sendPayoutPaidEmail(practitionerEmail, { amount, periodLabel, externalRef, locale }))
        }
      }

      // ── orders lifecycle ────────────────────────────────────────────
      // The orders module hydrates the buyer's email on each transition
      // before publishing (see orders.service.changeStatus). When the
      // payload doesn't carry buyerEmail this is a no-op.
      if (event.type === 'order.paid') {
        const { buyerEmail, buyerUserId, orderId, totalCents, currency } = event.payload ?? {}
        if (buyerEmail && !await maybeDigestEmail(event, { userId: buyerUserId, to: buyerEmail, locale })) {
          const { sendOrderPaidEmail } = await import('./email.service.js')
          await gated(buyerUserId, event.type, 'email', () => sendOrderPaidEmail(buyerEmail, { orderId, totalCents, currency, locale }))
        }
      }
      if (event.type === 'order.shipped') {
        const { buyerEmail, buyerUserId, orderId, trackingCode, carrier } = event.payload ?? {}
        if (buyerEmail) {
          const { sendOrderShippedEmail } = await import('./email.service.js')
          await gated(buyerUserId, event.type, 'email', () => sendOrderShippedEmail(buyerEmail, { orderId, trackingCode, carrier, locale }))
        }
      }
      if (event.type === 'order.delivered') {
        const { buyerEmail, buyerUserId, orderId } = event.payload ?? {}
        if (buyerEmail) {
          const { sendOrderDeliveredEmail } = await import('./email.service.js')
          await gated(buyerUserId, event.type, 'email', () => sendOrderDeliveredEmail(buyerEmail, { orderId, locale }))
        }
      }
      if (event.type === 'order.cancelled') {
        const { buyerEmail, buyerUserId, orderId, reason } = event.payload ?? {}
        if (buyerEmail) {
          const { sendOrderCancelledEmail } = await import('./email.service.js')
          await gated(buyerUserId, event.type, 'email', () => sendOrderCancelledEmail(buyerEmail, { orderId, reason, locale }))
        }
      }
      if (event.type === 'basket.abandoned') {
        // Producer is platform-scheduler — payload has userId but no email.
        // Hydrate from platform_auth.users via the cross-schema grant added
        // for orders (svc_platform_notifications already has access to its
        // own schema only; we look up via a per-request connection that
        // happens to share the role's grants — for now we stick to the
        // userId-known path).
        const { userId, itemCount } = event.payload ?? {}
        if (userId) {
          // Best effort: look up the email via the existing send_log pattern.
          // To avoid a new GRANT in this commit we accept that the producer
          // may evolve later to include the email directly. For now, just
          // log + skip if no buyerEmail in the payload.
          if (event.payload?.buyerEmail) {
            const { sendBasketAbandonedEmail } = await import('./email.service.js')
            await gated(userId, event.type, 'email', () => sendBasketAbandonedEmail(event.payload.buyerEmail, { itemCount, locale }))
          } else {
            logger.debug({ userId, itemCount }, 'basket.abandoned without buyerEmail — skipping (producer needs to hydrate)')
          }
        }
      }

      if (event.type === 'order.refunded') {
        const { buyerEmail, buyerUserId, orderId, totalCents, currency } = event.payload ?? {}
        if (buyerEmail) {
          const { sendOrderRefundedEmail } = await import('./email.service.js')
          await gated(buyerUserId, event.type, 'email', () => sendOrderRefundedEmail(buyerEmail, { orderId, totalCents, currency, locale }))
        }
      }

      // ── chat ──────────────────────────────────────────────────────────────
      // Chat events carry userIds (not emails — auth owns those), so the
      // resolvable channel is PUSH (tokens looked up per userId in
      // platform_notifications.push_devices). Offline recipients get a push.
      if (event.type === 'chat.message.created') {
        const { appId, tenantId, conversationId, messageId, senderUserId, recipientUserIds } = event.payload ?? {}
        for (const userId of recipientUserIds ?? []) {
          if (userId === senderUserId) continue
          const ctx = { appId, tenantId, subTenantId: null, userId, role: 'system' }
          await gated(userId, event.type, 'push', () => sendPushToUser(ctx, userId, {
            title: 'New message', body: '', data: { type: 'chat.message.created', conversationId, messageId },
          }), ctx)
        }
      }

      if (event.type === 'chat.mention.created') {
        const { appId, tenantId, conversationId, messageId, mentionedUserId } = event.payload ?? {}
        if (mentionedUserId) {
          const ctx = { appId, tenantId, subTenantId: null, userId: mentionedUserId, role: 'system' }
          await gated(mentionedUserId, event.type, 'push', () => sendPushToUser(ctx, mentionedUserId, {
            title: 'You were mentioned', body: '', data: { type: 'chat.mention.created', conversationId, messageId },
          }), ctx)
        }
      }

      if (event.type === 'chat.support.assigned') {
        const { appId, tenantId, conversationId, agentUserId } = event.payload ?? {}
        if (agentUserId) {
          const ctx = { appId, tenantId, subTenantId: null, userId: agentUserId, role: 'system' }
          await gated(agentUserId, event.type, 'push', () => sendPushToUser(ctx, agentUserId, {
            title: 'Support ticket assigned to you', body: '', data: { type: 'chat.support.assigned', conversationId },
          }))
        }
      }

      if (event.type === 'chat.support.sla_breached') {
        const { appId, tenantId, conversationId, assignedAgentUserId } = event.payload ?? {}
        if (assignedAgentUserId) {
          const ctx = { appId, tenantId, subTenantId: null, userId: assignedAgentUserId, role: 'system' }
          await gated(assignedAgentUserId, event.type, 'push', () => sendPushToUser(ctx, assignedAgentUserId, {
            title: 'Support SLA breached', body: '', data: { type: 'chat.support.sla_breached', conversationId },
          }))
        }
      }

      // ── reviews ─────────────────────────────────────────────────────────
      // The vendor replied to the buyer's review. Payload carries buyerUserId
      // (reviews own no email — auth does), so push is the resolvable channel.
      if (event.type === 'review.replied') {
        const { appId, tenantId, buyerUserId, reviewId } = event.payload ?? {}
        if (buyerUserId) {
          const ctx = { appId, tenantId, subTenantId: null, userId: buyerUserId, role: 'system' }
          await gated(buyerUserId, event.type, 'push', () => sendReviewRepliedPush(ctx, buyerUserId, { reviewId, locale }), ctx)
        }
      }

      // ── disputes ────────────────────────────────────────────────────────
      // dispute.opened / dispute.withdrawn carry the acting buyer's userId.
      // dispute.resolved / dispute.message carry no recipient userId (only a
      // role / amount) so they are intentionally not wired here.
      if (event.type === 'dispute.opened') {
        const { appId, tenantId, buyerUserId, disputeId, orderId } = event.payload ?? {}
        if (buyerUserId) {
          const ctx = { appId, tenantId, subTenantId: null, userId: buyerUserId, role: 'system' }
          await gated(buyerUserId, event.type, 'push', () => sendDisputeOpenedPush(ctx, buyerUserId, { disputeId, orderId, locale }), ctx)
        }
      }
      if (event.type === 'dispute.withdrawn') {
        const { appId, tenantId, withdrawnByUserId, disputeId } = event.payload ?? {}
        if (withdrawnByUserId) {
          const ctx = { appId, tenantId, subTenantId: null, userId: withdrawnByUserId, role: 'system' }
          await gated(withdrawnByUserId, event.type, 'push', () => sendDisputeWithdrawnPush(ctx, withdrawnByUserId, { disputeId, locale }), ctx)
        }
      }

      // ── packages (admin actions) ─────────────────────────────────────────
      // freeze / unfreeze / cancel(=refund) carry clientUserId → push channel.
      if (event.type === 'package.frozen') {
        const { appId, tenantId, clientUserId, packageId } = event.payload ?? {}
        if (clientUserId) {
          const ctx = { appId, tenantId, subTenantId: null, userId: clientUserId, role: 'system' }
          await gated(clientUserId, event.type, 'push', () => sendPackageFrozenPush(ctx, clientUserId, { packageId, locale }), ctx)
        }
      }
      if (event.type === 'package.unfrozen') {
        const { appId, tenantId, clientUserId, packageId, daysAdded } = event.payload ?? {}
        if (clientUserId) {
          const ctx = { appId, tenantId, subTenantId: null, userId: clientUserId, role: 'system' }
          await gated(clientUserId, event.type, 'push', () => sendPackageUnfrozenPush(ctx, clientUserId, { packageId, daysAdded, locale }), ctx)
        }
      }
      if (event.type === 'package.refunded') {
        const { appId, tenantId, clientUserId, packageId, refundCents, currency } = event.payload ?? {}
        if (clientUserId) {
          const ctx = { appId, tenantId, subTenantId: null, userId: clientUserId, role: 'system' }
          await gated(clientUserId, event.type, 'push', () => sendPackageRefundedPush(ctx, clientUserId, { packageId, refundCents, currency, locale }), ctx)
        }
      }

      // ── waitlist promotions (anonymous guests/clients — SMS only) ─────────
      // A table / slot freed up and this party is next. Waitlist entries are
      // typically created without a user account (name + phone only), so SMS
      // is the resolvable channel. No userId → no rate-limit gate (send direct,
      // same as inquiry/lead). Errors are swallowed by the sms sender itself.
      if (event.type === 'waitlist.notified') {
        const { guestPhone, guestName } = event.payload ?? {}
        if (guestPhone) {
          try {
            await sendWaitlistNotifiedSms(guestPhone, { guestName, locale })
          } catch (err) {
            logger.error({ err }, 'sendWaitlistNotifiedSms failed')
          }
        }
      }
      if (event.type === 'booking.waitlist.notified') {
        const { clientPhone } = event.payload ?? {}
        if (clientPhone) {
          try {
            await sendBookingWaitlistNotifiedSms(clientPhone, { locale })
          } catch (err) {
            logger.error({ err }, 'sendBookingWaitlistNotifiedSms failed')
          }
        }
      }
    } catch (err) {
      logger.error({ err, event }, 'Error handling event')
    }
  })

  sub.on('error', (err) => logger.error({ err }, 'Redis subscriber error'))

  return sub
}
