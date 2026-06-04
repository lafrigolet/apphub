// Verifica que el event-consumer reacciona a lead.created enviando la
// auto-respuesta (acuse) al prospecto: sendLeadAcknowledgementEmail.
// El initiator es anónimo (sin userId) → sin rate-limit gate.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', REDIS_URL: 'redis://localhost:6379' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../services/rate-limit.service.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}))

const { senders, logger } = vi.hoisted(() => {
  const make = () => vi.fn()
  return {
    logger: { info: make(), debug: make(), warn: make(), error: make() },
    senders: {
      sendLeadAcknowledgementEmail: make(),
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
      sendPayoutPaidEmail: make(),
      sendDonationThankYou: make(), sendDonationMonthlyReceipt: make(),
      sendDonationPaymentFailed: make(), sendDonationCancelled: make(),
      sendDonationRefunded: make(), sendDonationCertificateReady: make(),
      sendInquiryAdminAlert: make(), sendInquiryUserThankYou: make(),
      invalidateConfigCache: make(),
    },
  }
})
vi.mock('../services/email.service.js', () => senders)

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

describe('lead.created', () => {
  it('envía el acuse al email del lead con su nombre', async () => {
    await emit({
      type: 'lead.created',
      payload: { leadId: 'l1', email: 'ana@x.com', contactName: 'Ana', industry: 'shop' },
    })
    expect(senders.sendLeadAcknowledgementEmail).toHaveBeenCalledWith(
      'ana@x.com',
      expect.objectContaining({ contactName: 'Ana', locale: 'es' }),
    )
  })

  it('respeta locale del payload', async () => {
    await emit({
      type: 'lead.created',
      payload: { leadId: 'l1', email: 'bob@x.com', contactName: 'Bob', locale: 'en' },
    })
    expect(senders.sendLeadAcknowledgementEmail).toHaveBeenCalledWith(
      'bob@x.com',
      expect.objectContaining({ locale: 'en' }),
    )
  })

  it('sin email en el payload → no envía', async () => {
    await emit({ type: 'lead.created', payload: { leadId: 'l1' } })
    expect(senders.sendLeadAcknowledgementEmail).not.toHaveBeenCalled()
  })

  it('el sender lanza → el consumer no propaga (best-effort)', async () => {
    senders.sendLeadAcknowledgementEmail.mockRejectedValueOnce(new Error('smtp down'))
    await expect(emit({
      type: 'lead.created',
      payload: { leadId: 'l1', email: 'ana@x.com' },
    })).resolves.toBeUndefined()
  })
})
