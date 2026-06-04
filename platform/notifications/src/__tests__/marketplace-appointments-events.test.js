// Verifica que el event-consumer reacciona a los eventos cableados en esta ola:
//
//   review.replied              → sendReviewRepliedPush       (buyerUserId)
//   dispute.opened              → sendDisputeOpenedPush       (buyerUserId)
//   dispute.withdrawn           → sendDisputeWithdrawnPush    (withdrawnByUserId)
//   package.frozen              → sendPackageFrozenPush       (clientUserId)
//   package.unfrozen            → sendPackageUnfrozenPush     (clientUserId)
//   package.refunded            → sendPackageRefundedPush     (clientUserId)
//   waitlist.notified           → sendWaitlistNotifiedSms     (guestPhone, anónimo)
//   booking.waitlist.notified   → sendBookingWaitlistNotifiedSms (clientPhone, anónimo)
//
// Patrón idéntico a donation-events.test.js: se mockean los senders y se
// inyectan eventos a través del handler 'message' del subscriber.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', REDIS_URL: 'redis://localhost:6379' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// gated() consulta rate-limit + preferencias: ambos pasan SIEMPRE para que
// el sender se invoque.
vi.mock('../services/rate-limit.service.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}))
vi.mock('../services/preferences.service.js', () => ({
  isMuted: vi.fn().mockResolvedValue(false),
}))
vi.mock('../services/idempotency.service.js', () => ({
  claimEvent: vi.fn().mockResolvedValue(true),
}))
vi.mock('../services/digest.service.js', () => ({
  shouldDigest: vi.fn().mockResolvedValue(false),
  enqueueDigest: vi.fn(),
  flushAll: vi.fn(),
}))

// Mock de los tres senders. Sólo nos importan los wrappers nuevos; el resto
// quedan como no-op para satisfacer los imports top-level del consumer.
const { email, sms, push } = vi.hoisted(() => {
  const make = () => vi.fn()
  return {
    email: {
      sendRaw: make(),
      sendWelcomeEmail: make(), sendPasswordResetEmail: make(),
      sendMagicLinkEmail: make(), sendMagicLinkPendingApprovalEmail: make(),
      sendSignupRequestedEmail: make(), sendSignupApprovedEmail: make(), sendSignupRejectedEmail: make(),
      sendTenantBootstrapEmail: make(), sendTenantActivatedEmail: make(),
      sendBookingReminderEmail: make(), sendReservationReminderEmail: make(),
      sendPackageExpiryEmail: make(), sendDisputeSlaInternalEmail: make(),
      sendBookingConfirmedEmail: make(), sendBookingCancelledEmail: make(), sendBookingRescheduledEmail: make(),
      sendReservationCreatedEmail: make(), sendReservationCancelledEmail: make(),
      sendPackageExhaustedEmail: make(), sendBasketAbandonedEmail: make(),
      sendOrderPaidEmail: make(), sendOrderShippedEmail: make(), sendOrderDeliveredEmail: make(),
      sendOrderCancelledEmail: make(), sendOrderRefundedEmail: make(),
      sendPayoutPaidEmail: make(), invalidateConfigCache: make(),
    },
    sms: {
      sendBookingReminderSms: make(), sendReservationReminderSms: make(),
      sendBookingConfirmedSms: make(), sendBookingCancelledSms: make(), sendBookingRescheduledSms: make(),
      sendReservationCancelledSms: make(),
      sendWaitlistNotifiedSms: make(), sendBookingWaitlistNotifiedSms: make(),
    },
    push: {
      sendBookingReminderPush: make(), sendBookingConfirmedPush: make(), sendReservationReminderPush: make(),
      sendPushToUser: make(),
      sendReviewRepliedPush: make(), sendDisputeOpenedPush: make(), sendDisputeWithdrawnPush: make(),
      sendPackageFrozenPush: make(), sendPackageUnfrozenPush: make(), sendPackageRefundedPush: make(),
    },
  }
})
vi.mock('../services/email.service.js', () => email)
vi.mock('../services/sms.service.js', () => sms)
vi.mock('../services/push.service.js', () => push)

let messageHandler
vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
    subscribe:  vi.fn((_channel, cb) => cb(null)),
    psubscribe: vi.fn((_pattern, cb) => cb(null)),
    on: vi.fn((evt, h) => {
      if (evt === 'message')  messageHandler = h
      if (evt === 'pmessage') messageHandler = (channel, payload) => h('*', channel, payload)
    }),
  })),
}))

import { startEventConsumer } from '../services/event-consumer.js'

beforeEach(() => {
  vi.clearAllMocks()
  messageHandler = undefined
  startEventConsumer()
})

async function emit(event) {
  await messageHandler('platform.events', JSON.stringify(event))
}

// ── review.replied ───────────────────────────────────────────────────────

describe('review.replied', () => {
  it('push al buyer cuando hay buyerUserId', async () => {
    await emit({
      type: 'review.replied',
      payload: { appId: 'mk', tenantId: 't1', buyerUserId: 'u1', reviewId: 'r1', replyId: 'rep1' },
    })
    expect(push.sendReviewRepliedPush).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'mk', tenantId: 't1', userId: 'u1' }),
      'u1',
      expect.objectContaining({ reviewId: 'r1' }),
    )
  })

  it('NO push si falta buyerUserId', async () => {
    await emit({ type: 'review.replied', payload: { appId: 'mk', tenantId: 't1' } })
    expect(push.sendReviewRepliedPush).not.toHaveBeenCalled()
  })
})

// ── dispute.opened / dispute.withdrawn ───────────────────────────────────

describe('disputes', () => {
  it('dispute.opened → push al buyerUserId', async () => {
    await emit({
      type: 'dispute.opened',
      payload: { appId: 'mk', tenantId: 't1', buyerUserId: 'u2', disputeId: 'd1', orderId: 'o1' },
    })
    expect(push.sendDisputeOpenedPush).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u2' }), 'u2',
      expect.objectContaining({ disputeId: 'd1', orderId: 'o1' }),
    )
  })

  it('dispute.withdrawn → push al withdrawnByUserId', async () => {
    await emit({
      type: 'dispute.withdrawn',
      payload: { appId: 'mk', tenantId: 't1', withdrawnByUserId: 'u3', disputeId: 'd2' },
    })
    expect(push.sendDisputeWithdrawnPush).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u3' }), 'u3',
      expect.objectContaining({ disputeId: 'd2' }),
    )
  })

  it('dispute.resolved NO dispara push (sin destinatario en payload)', async () => {
    await emit({ type: 'dispute.resolved', payload: { appId: 'mk', tenantId: 't1', disputeId: 'd3' } })
    expect(push.sendDisputeOpenedPush).not.toHaveBeenCalled()
    expect(push.sendDisputeWithdrawnPush).not.toHaveBeenCalled()
  })
})

// ── package.frozen / unfrozen / refunded ─────────────────────────────────

describe('packages', () => {
  it('package.frozen → push al clientUserId', async () => {
    await emit({
      type: 'package.frozen',
      payload: { appId: 'ap', tenantId: 't1', clientUserId: 'c1', packageId: 'p1' },
    })
    expect(push.sendPackageFrozenPush).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'c1' }), 'c1',
      expect.objectContaining({ packageId: 'p1' }),
    )
  })

  it('package.unfrozen → push con daysAdded', async () => {
    await emit({
      type: 'package.unfrozen',
      payload: { appId: 'ap', tenantId: 't1', clientUserId: 'c1', packageId: 'p1', daysAdded: 5 },
    })
    expect(push.sendPackageUnfrozenPush).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'c1' }), 'c1',
      expect.objectContaining({ packageId: 'p1', daysAdded: 5 }),
    )
  })

  it('package.refunded → push con refundCents + currency', async () => {
    await emit({
      type: 'package.refunded',
      payload: { appId: 'ap', tenantId: 't1', clientUserId: 'c1', packageId: 'p1', refundCents: 4500, currency: 'EUR' },
    })
    expect(push.sendPackageRefundedPush).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'c1' }), 'c1',
      expect.objectContaining({ refundCents: 4500, currency: 'EUR' }),
    )
  })

  it('NO push si falta clientUserId', async () => {
    await emit({ type: 'package.frozen', payload: { appId: 'ap', tenantId: 't1', packageId: 'p1' } })
    expect(push.sendPackageFrozenPush).not.toHaveBeenCalled()
  })
})

// ── waitlist.notified / booking.waitlist.notified (SMS) ──────────────────

describe('waitlist promotions (SMS)', () => {
  it('waitlist.notified → SMS al guestPhone', async () => {
    await emit({
      type: 'waitlist.notified',
      payload: { appId: 're', tenantId: 't1', waitlistId: 'w1', guestPhone: '+34600111222', guestName: 'Ana' },
    })
    expect(sms.sendWaitlistNotifiedSms).toHaveBeenCalledWith(
      '+34600111222',
      expect.objectContaining({ guestName: 'Ana' }),
    )
  })

  it('waitlist.notified sin guestPhone → no envía', async () => {
    await emit({ type: 'waitlist.notified', payload: { appId: 're', tenantId: 't1', waitlistId: 'w1' } })
    expect(sms.sendWaitlistNotifiedSms).not.toHaveBeenCalled()
  })

  it('booking.waitlist.notified → SMS al clientPhone', async () => {
    await emit({
      type: 'booking.waitlist.notified',
      payload: { appId: 'ap', tenantId: 't1', waitlistId: 'bw1', clientPhone: '+34600333444' },
    })
    expect(sms.sendBookingWaitlistNotifiedSms).toHaveBeenCalledWith(
      '+34600333444',
      expect.any(Object),
    )
  })
})

// ── No-trigger guard ─────────────────────────────────────────────────────

describe('eventos ajenos no disparan estos senders', () => {
  it('user.registered no toca los wrappers nuevos', async () => {
    await emit({ type: 'user.registered', payload: { email: 'x@x', appId: 'aikikan' } })
    expect(push.sendReviewRepliedPush).not.toHaveBeenCalled()
    expect(push.sendPackageFrozenPush).not.toHaveBeenCalled()
    expect(sms.sendWaitlistNotifiedSms).not.toHaveBeenCalled()
  })
})
