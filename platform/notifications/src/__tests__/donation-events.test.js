// Verifica que el event-consumer reacciona a los eventos del módulo
// donations: enruta cada tipo al sender correcto del email service,
// con los argumentos esperados.
//
// Eventos cubiertos:
//   donation.completed             → sendDonationThankYou
//   donation.recurring.charged     → sendDonationMonthlyReceipt
//   donation.recurring.failed      → sendDonationPaymentFailed
//   donation.recurring.cancelled   → sendDonationCancelled
//   donation.refunded              → sendDonationRefunded
//   donation.certificate.ready     → sendDonationCertificateReady

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', REDIS_URL: 'redis://localhost:6379' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// El consumer hace `await gated(userId, type, channel, fn)`. Stubeamos
// rate-limit para que SIEMPRE deje pasar — así el sender se invoca.
vi.mock('../services/rate-limit.service.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}))

// Mockeamos TODOS los senders que el consumer importa (tanto top-level
// como dinámicos con `await import(...)`). Vitest hoist requiere
// vi.hoisted para compartir las refs.
const { senders } = vi.hoisted(() => {
  const make = () => vi.fn()
  return {
    senders: {
      // donations (los que aquí probamos)
      sendDonationThankYou:         make(),
      sendDonationMonthlyReceipt:   make(),
      sendDonationPaymentFailed:    make(),
      sendDonationCancelled:        make(),
      sendDonationRefunded:         make(),
      sendDonationCertificateReady: make(),
      // resto de senders que el consumer importa en su top-level — no-op
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
  }
})
vi.mock('../services/email.service.js', () => senders)

// Capturamos el handler 'message' del subscriber para inyectar eventos.
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

// ── donation.completed ──────────────────────────────────────────────────

describe('donation.completed', () => {
  it('one_shot → sendDonationThankYou', async () => {
    await emit({
      type: 'donation.completed',
      payload: {
        donorEmail: 'donor@x', donorName: 'Donante', amountCents: 2500,
        causeId: 'c1', kind: 'one_shot', userId: 'u1',
      },
    })
    expect(senders.sendDonationThankYou).toHaveBeenCalledWith(
      'donor@x',
      expect.objectContaining({ donorName: 'Donante', amountCents: 2500 }),
    )
  })

  it('primer cobro de recurring → también sendDonationThankYou (te has suscrito)', async () => {
    await emit({
      type: 'donation.completed',
      payload: {
        donorEmail: 'donor@x', donorName: 'Donante', amountCents: 1000,
        causeId: null, kind: 'recurring_monthly',
      },
    })
    expect(senders.sendDonationThankYou).toHaveBeenCalled()
  })

  it('NO envía email si falta donorEmail (campo crítico)', async () => {
    await emit({
      type: 'donation.completed',
      payload: { kind: 'one_shot', amountCents: 1000 },
    })
    expect(senders.sendDonationThankYou).not.toHaveBeenCalled()
  })
})

// ── donation.recurring.charged ──────────────────────────────────────────

describe('donation.recurring.charged (renovación mensual)', () => {
  it('envía recibo mensual via sendDonationMonthlyReceipt', async () => {
    await emit({
      type: 'donation.recurring.charged',
      payload: { donorEmail: 'donor@x', donorName: 'D', amountCents: 1000 },
    })
    expect(senders.sendDonationMonthlyReceipt).toHaveBeenCalledWith(
      'donor@x',
      expect.objectContaining({ donorName: 'D', amountCents: 1000 }),
    )
    expect(senders.sendDonationThankYou).not.toHaveBeenCalled()
  })
})

// ── donation.recurring.failed ───────────────────────────────────────────

describe('donation.recurring.failed', () => {
  it('envía sendDonationPaymentFailed (pago rechazado)', async () => {
    await emit({
      type: 'donation.recurring.failed',
      payload: { donorEmail: 'd@x', donorName: 'D', userId: 'u1' },
    })
    expect(senders.sendDonationPaymentFailed).toHaveBeenCalled()
  })
})

// ── donation.recurring.cancelled ────────────────────────────────────────

describe('donation.recurring.cancelled', () => {
  it('envía sendDonationCancelled', async () => {
    await emit({
      type: 'donation.recurring.cancelled',
      payload: { donorEmail: 'd@x', donorName: 'D' },
    })
    expect(senders.sendDonationCancelled).toHaveBeenCalled()
  })
})

// ── donation.refunded ───────────────────────────────────────────────────

describe('donation.refunded', () => {
  it('envía sendDonationRefunded con el importe', async () => {
    await emit({
      type: 'donation.refunded',
      payload: { donorEmail: 'd@x', donorName: 'D', amountCents: 2500 },
    })
    expect(senders.sendDonationRefunded).toHaveBeenCalledWith(
      'd@x',
      expect.objectContaining({ amountCents: 2500 }),
    )
  })
})

// ── donation.certificate.ready ──────────────────────────────────────────

describe('donation.certificate.ready', () => {
  it('envía sendDonationCertificateReady con certificateUrl + fiscalYear', async () => {
    await emit({
      type: 'donation.certificate.ready',
      payload: {
        donorEmail: 'd@x', donorName: 'D',
        fiscalYear: 2026, certificateUrl: 'https://presigned.x/cert.pdf',
        userId: 'u1',
      },
    })
    expect(senders.sendDonationCertificateReady).toHaveBeenCalledWith(
      'd@x',
      expect.objectContaining({
        year: 2026, certificateUrl: 'https://presigned.x/cert.pdf',
      }),
    )
  })

  it('NO envía si falta certificateUrl (no podemos linkar al PDF)', async () => {
    await emit({
      type: 'donation.certificate.ready',
      payload: { donorEmail: 'd@x', fiscalYear: 2026 },
    })
    expect(senders.sendDonationCertificateReady).not.toHaveBeenCalled()
  })
})

// ── No-trigger guard ────────────────────────────────────────────────────

describe('eventos no-donation NO disparan senders de donation', () => {
  it('user.registered → sendDonationThankYou never called', async () => {
    await emit({ type: 'user.registered', payload: { email: 'x@x', appId: 'aikikan' } })
    expect(senders.sendDonationThankYou).not.toHaveBeenCalled()
    expect(senders.sendDonationCertificateReady).not.toHaveBeenCalled()
  })
})
