// event-consumer — cobertura exhaustiva del dispatch por event.type.
// Mockea TODOS los módulos (email/sms/push/rate-limit/digest) incluyendo los
// que el consumer importa dinámicamente, y emite cada tipo de evento +
// variantes (canales email/sms/push, gate de rate-limit, digest hook,
// PLATFORM_PUBLIC_DOMAIN on/off, staff ops email).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', REDIS_URL: 'redis://localhost:6379' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const emailMock = vi.hoisted(() => {
  const names = [
    'sendWelcomeEmail', 'sendPasswordResetEmail', 'sendBookingReminderEmail',
    'sendReservationReminderEmail', 'sendPackageExpiryEmail', 'sendDisputeSlaInternalEmail',
    'sendBookingConfirmedEmail', 'sendBookingCancelledEmail', 'sendBookingRescheduledEmail',
    'sendReservationCreatedEmail', 'sendReservationCancelledEmail', 'sendPackageExhaustedEmail',
    'sendPayoutPaidEmail', 'sendMagicLinkPendingApprovalEmail', 'sendMagicLinkEmail',
    'sendDonationThankYou', 'sendDonationMonthlyReceipt', 'sendDonationPaymentFailed',
    'sendDonationCancelled', 'sendDonationRefunded', 'sendDonationCertificateReady',
    'sendInquiryAdminAlert', 'sendInquiryUserThankYou', 'sendSignupRequestedEmail',
    'sendSignupApprovedEmail', 'sendSignupRejectedEmail', 'sendTenantBootstrapEmail',
    'sendTenantActivatedEmail', 'sendOrderPaidEmail', 'sendOrderShippedEmail',
    'sendOrderDeliveredEmail', 'sendOrderCancelledEmail', 'sendOrderRefundedEmail',
    'sendBasketAbandonedEmail', 'sendRaw',
  ]
  return Object.fromEntries(names.map((n) => [n, vi.fn()]))
})
vi.mock('../services/email.service.js', () => emailMock)

const smsMock = vi.hoisted(() => Object.fromEntries(
  ['sendBookingReminderSms', 'sendReservationReminderSms', 'sendBookingConfirmedSms',
    'sendBookingCancelledSms', 'sendBookingRescheduledSms', 'sendReservationCancelledSms']
    .map((n) => [n, vi.fn()]),
))
vi.mock('../services/sms.service.js', () => smsMock)

const pushMock = vi.hoisted(() => Object.fromEntries(
  ['sendBookingReminderPush', 'sendBookingConfirmedPush', 'sendReservationReminderPush', 'sendPushToUser']
    .map((n) => [n, vi.fn()]),
))
vi.mock('../services/push.service.js', () => pushMock)

const rate = vi.hoisted(() => ({ checkRateLimit: vi.fn() }))
vi.mock('../services/rate-limit.service.js', () => rate)

const digest = vi.hoisted(() => ({ shouldDigest: vi.fn(), enqueueDigest: vi.fn(), flushAll: vi.fn() }))
vi.mock('../services/digest.service.js', () => digest)

let capturedMessageHandler
let errorHandler
vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
    subscribe: vi.fn((_c, cb) => cb(null)),
    on: vi.fn((event, handler) => {
      if (event === 'message') capturedMessageHandler = handler
      if (event === 'error') errorHandler = handler
    }),
  })),
}))

import { startEventConsumer } from '../services/event-consumer.js'
import { logger } from '../lib/logger.js'

beforeEach(() => {
  vi.clearAllMocks()
  capturedMessageHandler = undefined
  rate.checkRateLimit.mockResolvedValue({ allowed: true })
  digest.shouldDigest.mockResolvedValue(false)
  digest.flushAll.mockResolvedValue({ flushed: 0 })
  delete process.env.PLATFORM_PUBLIC_DOMAIN
  delete process.env.STAFF_OPS_EMAIL
  startEventConsumer()
})
afterEach(() => { delete process.env.PLATFORM_PUBLIC_DOMAIN; delete process.env.STAFF_OPS_EMAIL })

const emit = (event) => capturedMessageHandler('platform.events', JSON.stringify(event))

describe('chat events → push', () => {
  it('chat.message.created pushes each recipient except sender', async () => {
    await emit({ type: 'chat.message.created', payload: { appId: 'a', tenantId: 't', conversationId: 'c1', messageId: 'm1', senderUserId: 'me', recipientUserIds: ['me', 'u2'] } })
    expect(pushMock.sendPushToUser).toHaveBeenCalledTimes(1)
    expect(pushMock.sendPushToUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u2' }), 'u2', expect.objectContaining({ data: expect.objectContaining({ type: 'chat.message.created' }) }),
    )
  })
  it('chat.mention.created pushes the mentioned user', async () => {
    await emit({ type: 'chat.mention.created', payload: { appId: 'a', tenantId: 't', conversationId: 'c1', messageId: 'm1', mentionedUserId: 'u3' } })
    expect(pushMock.sendPushToUser).toHaveBeenCalledWith(expect.any(Object), 'u3', expect.objectContaining({ data: expect.objectContaining({ type: 'chat.mention.created' }) }))
  })
  it('chat.support.assigned pushes the agent', async () => {
    await emit({ type: 'chat.support.assigned', payload: { appId: 'a', tenantId: 't', conversationId: 'c1', agentUserId: 'ag1' } })
    expect(pushMock.sendPushToUser).toHaveBeenCalledWith(expect.any(Object), 'ag1', expect.objectContaining({ data: expect.objectContaining({ type: 'chat.support.assigned' }) }))
  })
  it('chat.support.sla_breached pushes the assigned agent when present', async () => {
    await emit({ type: 'chat.support.sla_breached', payload: { appId: 'a', tenantId: 't', conversationId: 'c1', assignedAgentUserId: 'ag1' } })
    expect(pushMock.sendPushToUser).toHaveBeenCalledWith(expect.any(Object), 'ag1', expect.objectContaining({ data: expect.objectContaining({ type: 'chat.support.sla_breached' }) }))
    pushMock.sendPushToUser.mockClear()
    await emit({ type: 'chat.support.sla_breached', payload: { appId: 'a', tenantId: 't', conversationId: 'c1', assignedAgentUserId: null } })
    expect(pushMock.sendPushToUser).not.toHaveBeenCalled()
  })
})

describe('auth flows', () => {
  it('password_reset con PLATFORM_PUBLIC_DOMAIN → https url', async () => {
    process.env.PLATFORM_PUBLIC_DOMAIN = 'hulkstein.com'
    await emit({ type: 'auth.password_reset_requested', payload: { email: 'a@x', token: 'T', appId: 'aikikan' } })
    expect(emailMock.sendPasswordResetEmail).toHaveBeenCalledWith('a@x', expect.stringContaining('https://aikikan.hulkstein.com'), 'es')
  })

  it('password_reset sin subdomain → fallback hulkstein.local', async () => {
    await emit({ type: 'auth.password_reset_requested', payload: { email: 'a@x', token: 'T' } })
    expect(emailMock.sendPasswordResetEmail).toHaveBeenCalledWith('a@x', expect.stringContaining('hulkstein.local'), 'es')
  })

  it('magic_link_blocked_pending_approval', async () => {
    await emit({ type: 'auth.magic_link_blocked_pending_approval', payload: { email: 'a@x', displayName: 'A' } })
    expect(emailMock.sendMagicLinkPendingApprovalEmail).toHaveBeenCalled()
  })

  it('magic_link_requested compone url', async () => {
    process.env.PLATFORM_PUBLIC_DOMAIN = 'hulkstein.com'
    await emit({ type: 'auth.magic_link_requested', payload: { email: 'a@x', token: 'T', appId: 'aikikan' } })
    expect(emailMock.sendMagicLinkEmail).toHaveBeenCalledWith('a@x', expect.objectContaining({ magicLinkUrl: expect.stringContaining('magic-login?token=T') }))
  })

  it('magic_link_requested sin subdomain → fallback hulkstein.local', async () => {
    await emit({ type: 'auth.magic_link_requested', payload: { email: 'a@x', token: 'T' } })
    expect(emailMock.sendMagicLinkEmail).toHaveBeenCalledWith('a@x', expect.objectContaining({ magicLinkUrl: expect.stringContaining('hulkstein.local') }))
  })

  it('signup.approved sin subdomain → fallback hulkstein.local', async () => {
    await emit({ type: 'auth.signup.approved', payload: { email: 'a@x', token: 'T' } })
    expect(emailMock.sendSignupApprovedEmail).toHaveBeenCalledWith('a@x', expect.objectContaining({ magicLinkUrl: expect.stringContaining('hulkstein.local') }))
  })

  it('signup.requested / approved / rejected', async () => {
    process.env.PLATFORM_PUBLIC_DOMAIN = 'hulkstein.com'
    await emit({ type: 'auth.signup.requested', payload: { email: 'a@x', displayName: 'A' } })
    await emit({ type: 'auth.signup.approved', payload: { email: 'a@x', token: 'T', appId: 'aikikan' } })
    await emit({ type: 'auth.signup.rejected', payload: { email: 'a@x', reason: 'spam' } })
    expect(emailMock.sendSignupRequestedEmail).toHaveBeenCalled()
    expect(emailMock.sendSignupApprovedEmail).toHaveBeenCalled()
    expect(emailMock.sendSignupRejectedEmail).toHaveBeenCalled()
  })
})

describe('donations', () => {
  it('completed one_shot + recurring_monthly', async () => {
    await emit({ type: 'donation.completed', payload: { donorEmail: 'd@x', kind: 'one_shot', amountCents: 100 } })
    await emit({ type: 'donation.completed', payload: { donorEmail: 'd@x', kind: 'recurring_monthly', amountCents: 100 } })
    expect(emailMock.sendDonationThankYou).toHaveBeenCalledTimes(2)
  })

  it('recurring charged / failed / cancelled, refunded, certificate', async () => {
    await emit({ type: 'donation.recurring.charged', payload: { donorEmail: 'd@x', amountCents: 100 } })
    await emit({ type: 'donation.recurring.failed', payload: { donorEmail: 'd@x' } })
    await emit({ type: 'donation.recurring.cancelled', payload: { donorEmail: 'd@x' } })
    await emit({ type: 'donation.refunded', payload: { donorEmail: 'd@x', amountCents: 50 } })
    await emit({ type: 'donation.certificate.ready', payload: { donorEmail: 'd@x', certificateUrl: 'http://c', fiscalYear: 2025 } })
    expect(emailMock.sendDonationMonthlyReceipt).toHaveBeenCalled()
    expect(emailMock.sendDonationPaymentFailed).toHaveBeenCalled()
    expect(emailMock.sendDonationCancelled).toHaveBeenCalled()
    expect(emailMock.sendDonationRefunded).toHaveBeenCalled()
    expect(emailMock.sendDonationCertificateReady).toHaveBeenCalled()
  })
})

describe('inquiries', () => {
  it('created → admin alert + user thank you', async () => {
    await emit({ type: 'inquiry.created', payload: { contactInboxEmail: 'admin@x', email: 'u@x', contactName: 'A', reference: 'R' } })
    expect(emailMock.sendInquiryAdminAlert).toHaveBeenCalled()
    expect(emailMock.sendInquiryUserThankYou).toHaveBeenCalled()
  })

  it('errores en alert/thankyou se loguean y no crashean', async () => {
    emailMock.sendInquiryAdminAlert.mockRejectedValueOnce(new Error('x'))
    emailMock.sendInquiryUserThankYou.mockRejectedValueOnce(new Error('y'))
    await emit({ type: 'inquiry.created', payload: { contactInboxEmail: 'admin@x', email: 'u@x', reference: 'R' } })
    expect(logger.error).toHaveBeenCalled()
  })
})

describe('tenant lifecycle', () => {
  it('bootstrap_started + activated', async () => {
    await emit({ type: 'tenant.bootstrap_started', payload: { ownerEmail: 'o@x', magicLinkUrl: 'http://m' } })
    await emit({ type: 'tenant.activated', payload: { ownerEmail: 'o@x' } })
    expect(emailMock.sendTenantBootstrapEmail).toHaveBeenCalled()
    expect(emailMock.sendTenantActivatedEmail).toHaveBeenCalled()
  })
})

describe('scheduler reminders (email/sms/push)', () => {
  it('booking.reminder.due dispara los 3 canales', async () => {
    await emit({ type: 'booking.reminder.due', payload: { appId: 'a', tenantId: 't', clientEmail: 'c@x', clientPhone: '+34', clientUserId: 'u1', startsAt: '2026-06-01', window: 't_minus_24h' } })
    expect(emailMock.sendBookingReminderEmail).toHaveBeenCalled()
    expect(smsMock.sendBookingReminderSms).toHaveBeenCalled()
    expect(pushMock.sendBookingReminderPush).toHaveBeenCalled()
  })

  it('reservation.reminder.due los 3 canales', async () => {
    await emit({ type: 'reservation.reminder.due', payload: { appId: 'a', tenantId: 't', guestEmail: 'g@x', guestPhone: '+34', guestUserId: 'u1', reservedFor: '2026-06-01', partySize: 2, window: 't_minus_2h' } })
    expect(emailMock.sendReservationReminderEmail).toHaveBeenCalled()
    expect(smsMock.sendReservationReminderSms).toHaveBeenCalled()
    expect(pushMock.sendReservationReminderPush).toHaveBeenCalled()
  })

  it('package.expiring', async () => {
    await emit({ type: 'package.expiring', payload: { clientEmail: 'c@x', clientUserId: 'u1', remainingSessions: 2, expiresAt: '2026-06-01', window: 't_minus_30d' } })
    expect(emailMock.sendPackageExpiryEmail).toHaveBeenCalled()
  })

  it('dispute.sla_breached con STAFF_OPS_EMAIL', async () => {
    process.env.STAFF_OPS_EMAIL = 'ops@x'
    await emit({ type: 'dispute.sla_breached', payload: { disputeId: 'd', orderId: 'o', openedAt: 'now' } })
    expect(emailMock.sendDisputeSlaInternalEmail).toHaveBeenCalled()
  })

  it('dispute.sla_breached sin STAFF_OPS_EMAIL → no envía', async () => {
    await emit({ type: 'dispute.sla_breached', payload: { disputeId: 'd' } })
    expect(emailMock.sendDisputeSlaInternalEmail).not.toHaveBeenCalled()
  })
})

describe('booking/reservation/package lifecycle + digest', () => {
  it('booking.confirmed los 3 canales (sin digest)', async () => {
    await emit({ type: 'booking.confirmed', payload: { appId: 'a', tenantId: 't', clientEmail: 'c@x', clientPhone: '+34', clientUserId: 'u1', startsAt: '2026-06-01' } })
    expect(emailMock.sendBookingConfirmedEmail).toHaveBeenCalled()
    expect(smsMock.sendBookingConfirmedSms).toHaveBeenCalled()
    expect(pushMock.sendBookingConfirmedPush).toHaveBeenCalled()
  })

  it('booking.confirmed con digest activado → bufferiza email, no envía', async () => {
    digest.shouldDigest.mockResolvedValue(true)
    await emit({ type: 'booking.confirmed', payload: { clientEmail: 'c@x', clientUserId: 'u1', startsAt: '2026-06-01' } })
    expect(digest.enqueueDigest).toHaveBeenCalled()
    expect(emailMock.sendBookingConfirmedEmail).not.toHaveBeenCalled()
  })

  it('booking.cancelled / rescheduled (email+sms)', async () => {
    await emit({ type: 'booking.cancelled', payload: { clientEmail: 'c@x', clientPhone: '+34', clientUserId: 'u1', startsAt: 'd', reason: 'x' } })
    await emit({ type: 'booking.rescheduled', payload: { clientEmail: 'c@x', clientPhone: '+34', clientUserId: 'u1', startsAt: 'd' } })
    expect(emailMock.sendBookingCancelledEmail).toHaveBeenCalled()
    expect(smsMock.sendBookingCancelledSms).toHaveBeenCalled()
    expect(emailMock.sendBookingRescheduledEmail).toHaveBeenCalled()
    expect(smsMock.sendBookingRescheduledSms).toHaveBeenCalled()
  })

  it('reservation.created / cancelled', async () => {
    await emit({ type: 'reservation.created', payload: { guestEmail: 'g@x', guestUserId: 'u1', reservedFor: 'd', partySize: 2 } })
    await emit({ type: 'reservation.cancelled', payload: { guestEmail: 'g@x', guestPhone: '+34', guestUserId: 'u1', reservedFor: 'd' } })
    expect(emailMock.sendReservationCreatedEmail).toHaveBeenCalled()
    expect(emailMock.sendReservationCancelledEmail).toHaveBeenCalled()
    expect(smsMock.sendReservationCancelledSms).toHaveBeenCalled()
  })

  it('package.exhausted', async () => {
    await emit({ type: 'package.exhausted', payload: { clientEmail: 'c@x', clientUserId: 'u1' } })
    expect(emailMock.sendPackageExhaustedEmail).toHaveBeenCalled()
  })

  it('notifications.digest.flush → flushAll', async () => {
    await emit({ type: 'notifications.digest.flush', payload: {} })
    expect(digest.flushAll).toHaveBeenCalled()
  })

  it('payout.paid', async () => {
    await emit({ type: 'payout.paid', payload: { practitionerEmail: 'p@x', practitionerUserId: 'u1', amount: '10', periodLabel: 'May', externalRef: 'r' } })
    expect(emailMock.sendPayoutPaidEmail).toHaveBeenCalled()
  })
})

describe('orders + basket', () => {
  it('paid / shipped / delivered / cancelled / refunded', async () => {
    await emit({ type: 'order.paid', payload: { buyerEmail: 'b@x', buyerUserId: 'u1', orderId: 'o', totalCents: 100, currency: 'EUR' } })
    await emit({ type: 'order.shipped', payload: { buyerEmail: 'b@x', buyerUserId: 'u1', orderId: 'o', trackingCode: 'T', carrier: 'UPS' } })
    await emit({ type: 'order.delivered', payload: { buyerEmail: 'b@x', buyerUserId: 'u1', orderId: 'o' } })
    await emit({ type: 'order.cancelled', payload: { buyerEmail: 'b@x', buyerUserId: 'u1', orderId: 'o', reason: 'x' } })
    await emit({ type: 'order.refunded', payload: { buyerEmail: 'b@x', buyerUserId: 'u1', orderId: 'o', totalCents: 100, currency: 'EUR' } })
    expect(emailMock.sendOrderPaidEmail).toHaveBeenCalled()
    expect(emailMock.sendOrderShippedEmail).toHaveBeenCalled()
    expect(emailMock.sendOrderDeliveredEmail).toHaveBeenCalled()
    expect(emailMock.sendOrderCancelledEmail).toHaveBeenCalled()
    expect(emailMock.sendOrderRefundedEmail).toHaveBeenCalled()
  })

  it('basket.abandoned con buyerEmail → envía', async () => {
    await emit({ type: 'basket.abandoned', payload: { userId: 'u1', itemCount: 2, buyerEmail: 'b@x' } })
    expect(emailMock.sendBasketAbandonedEmail).toHaveBeenCalled()
  })

  it('basket.abandoned sin buyerEmail → log debug, no envía', async () => {
    await emit({ type: 'basket.abandoned', payload: { userId: 'u1', itemCount: 2 } })
    expect(emailMock.sendBasketAbandonedEmail).not.toHaveBeenCalled()
    expect(logger.debug).toHaveBeenCalled()
  })
})

describe('rate-limit gate', () => {
  it('checkRateLimit no permitido → suprime el envío', async () => {
    rate.checkRateLimit.mockResolvedValue({ allowed: false, reason: 'hour_cap' })
    await emit({ type: 'user.registered', payload: { email: 'a@x', appId: 'aikikan', userId: 'u1' } })
    expect(emailMock.sendWelcomeEmail).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ reason: 'hour_cap' }), expect.any(String))
  })
})

describe('skips cuando faltan campos clave (ramas falsy)', () => {
  const noopEvents = [
    { type: 'user.registered', payload: {} },
    { type: 'auth.password_reset_requested', payload: { email: 'a@x' } },
    { type: 'auth.magic_link_blocked_pending_approval', payload: {} },
    { type: 'auth.magic_link_requested', payload: { email: 'a@x' } },
    { type: 'donation.completed', payload: {} },
    { type: 'donation.completed', payload: { donorEmail: 'd@x', kind: 'other' } },
    { type: 'donation.recurring.charged', payload: {} },
    { type: 'donation.recurring.failed', payload: {} },
    { type: 'donation.recurring.cancelled', payload: {} },
    { type: 'donation.refunded', payload: {} },
    { type: 'donation.certificate.ready', payload: { donorEmail: 'd@x' } },
    { type: 'inquiry.created', payload: {} },
    { type: 'auth.signup.requested', payload: {} },
    { type: 'auth.signup.approved', payload: { email: 'a@x' } },
    { type: 'auth.signup.rejected', payload: {} },
    { type: 'tenant.bootstrap_started', payload: {} },
    { type: 'tenant.activated', payload: {} },
    { type: 'booking.reminder.due', payload: {} },
    { type: 'reservation.reminder.due', payload: {} },
    { type: 'package.expiring', payload: {} },
    { type: 'booking.confirmed', payload: {} },
    { type: 'booking.cancelled', payload: {} },
    { type: 'booking.rescheduled', payload: {} },
    { type: 'reservation.created', payload: {} },
    { type: 'reservation.cancelled', payload: {} },
    { type: 'package.exhausted', payload: {} },
    { type: 'payout.paid', payload: {} },
    { type: 'order.paid', payload: {} },
    { type: 'order.shipped', payload: {} },
    { type: 'order.delivered', payload: {} },
    { type: 'order.cancelled', payload: {} },
    { type: 'order.refunded', payload: {} },
    { type: 'basket.abandoned', payload: {} },
  ]

  it.each(noopEvents)('$type sin campos → no crashea', async (ev) => {
    await emit(ev)
    expect(logger.error).not.toHaveBeenCalled()
  })
})

describe('payload ausente por completo (rama event.payload ?? {})', () => {
  const types = [
    'user.registered', 'auth.password_reset_requested',
    'auth.magic_link_blocked_pending_approval', 'auth.magic_link_requested',
    'donation.completed', 'donation.recurring.charged', 'donation.recurring.failed',
    'donation.recurring.cancelled', 'donation.refunded', 'donation.certificate.ready',
    'inquiry.created', 'auth.signup.requested', 'auth.signup.approved',
    'auth.signup.rejected', 'tenant.bootstrap_started', 'tenant.activated',
    'booking.reminder.due', 'reservation.reminder.due', 'package.expiring',
    'dispute.sla_breached', 'booking.confirmed', 'booking.cancelled',
    'booking.rescheduled', 'reservation.created', 'reservation.cancelled',
    'package.exhausted', 'payout.paid', 'order.paid', 'order.shipped',
    'order.delivered', 'order.cancelled', 'order.refunded', 'basket.abandoned',
  ]
  it.each(types)('%s sin payload → no crashea', async (type) => {
    await emit({ type })
    expect(logger.error).not.toHaveBeenCalled()
  })
})

describe('donation: userId presente (rama izquierda de userId ?? null)', () => {
  it('completed/charged/failed/cancelled/refunded/certificate con userId', async () => {
    await emit({ type: 'donation.completed', payload: { donorEmail: 'd@x', kind: 'one_shot', amountCents: 1, userId: 'u9' } })
    await emit({ type: 'donation.completed', payload: { donorEmail: 'd@x', kind: 'recurring_monthly', amountCents: 1, userId: 'u9' } })
    await emit({ type: 'donation.recurring.charged', payload: { donorEmail: 'd@x', amountCents: 1, userId: 'u9' } })
    await emit({ type: 'donation.recurring.failed', payload: { donorEmail: 'd@x', userId: 'u9' } })
    await emit({ type: 'donation.recurring.cancelled', payload: { donorEmail: 'd@x', userId: 'u9' } })
    await emit({ type: 'donation.refunded', payload: { donorEmail: 'd@x', amountCents: 1, userId: 'u9' } })
    await emit({ type: 'donation.certificate.ready', payload: { donorEmail: 'd@x', certificateUrl: 'http://c', fiscalYear: 2025, userId: 'u9' } })
    expect(emailMock.sendDonationThankYou).toHaveBeenCalledTimes(2)
    expect(rate.checkRateLimit).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u9' }))
  })
})

describe('maybeDigestEmail — ramas parciales de (!userId || !to)', () => {
  it('booking.confirmed con email pero SIN clientUserId → no bufferiza, envía directo', async () => {
    digest.shouldDigest.mockResolvedValue(true)
    await emit({ type: 'booking.confirmed', payload: { clientEmail: 'c@x', startsAt: 'd' } })
    expect(digest.enqueueDigest).not.toHaveBeenCalled()
    expect(emailMock.sendBookingConfirmedEmail).toHaveBeenCalled()
  })

  it('payout.paid con email + userId pero shouldDigest=false → envía directo', async () => {
    digest.shouldDigest.mockResolvedValue(false)
    await emit({ type: 'payout.paid', payload: { practitionerEmail: 'p@x', practitionerUserId: 'u1', amount: '1', periodLabel: 'M', externalRef: 'r' } })
    expect(emailMock.sendPayoutPaidEmail).toHaveBeenCalled()
  })
})

describe('base sin subdomain ni appId → fallback hulkstein.local raíz', () => {
  it('password_reset con email+token pero sin appId/subdomain', async () => {
    await emit({ type: 'auth.password_reset_requested', payload: { email: 'a@x', token: 'T', appId: '' } })
    expect(emailMock.sendPasswordResetEmail).toHaveBeenCalledWith('a@x', 'http://hulkstein.local:8080/reset-password?token=T', 'es')
  })
})

describe('dispute.sla_breached con STAFF_OPS_EMAIL y payload ausente', () => {
  it('staffEmail set, payload undefined → destructura {} sin crash', async () => {
    process.env.STAFF_OPS_EMAIL = 'ops@x'
    await emit({ type: 'dispute.sla_breached' })
    expect(emailMock.sendDisputeSlaInternalEmail).toHaveBeenCalledWith('ops@x', expect.objectContaining({ disputeId: undefined, locale: 'es' }))
  })
})

describe('subdomain ?? appId — subdomain explícito en payload', () => {
  it('password_reset usa subdomain del payload si viene', async () => {
    process.env.PLATFORM_PUBLIC_DOMAIN = 'hulkstein.com'
    await emit({ type: 'auth.password_reset_requested', payload: { email: 'a@x', token: 'T', subdomain: 'custom' } })
    expect(emailMock.sendPasswordResetEmail).toHaveBeenCalledWith('a@x', expect.stringContaining('https://custom.hulkstein.com'), 'es')
  })

  it('magic_link_requested usa subdomain del payload', async () => {
    await emit({ type: 'auth.magic_link_requested', payload: { email: 'a@x', token: 'T', subdomain: 'custom' } })
    expect(emailMock.sendMagicLinkEmail).toHaveBeenCalledWith('a@x', expect.objectContaining({ magicLinkUrl: expect.stringContaining('custom.hulkstein.local') }))
  })

  it('signup.approved usa subdomain del payload', async () => {
    await emit({ type: 'auth.signup.approved', payload: { email: 'a@x', token: 'T', subdomain: 'custom' } })
    expect(emailMock.sendSignupApprovedEmail).toHaveBeenCalledWith('a@x', expect.objectContaining({ magicLinkUrl: expect.stringContaining('custom.hulkstein.local') }))
  })
})

describe('infra', () => {
  it('JSON malformado → no-op', async () => {
    await capturedMessageHandler('platform.events', '{bad')
    expect(emailMock.sendWelcomeEmail).not.toHaveBeenCalled()
  })

  it('handler de error de Redis loguea', () => {
    errorHandler(new Error('redis down'))
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error) }), expect.any(String))
  })
})
