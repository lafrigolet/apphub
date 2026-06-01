// email.service — camino de envío REAL (Resend) y todos los senders.
// Con NODE_ENV='production' + RESEND_API_KEY el guard `skip` es falso, así
// que send() construye el payload y llama resend.emails.send. Cubrimos:
//   - send happy (data) / error de Resend / excepción del SDK
//   - from con/sin senderName
//   - compose: per-field fallback cuando DB devuelve campos null
//   - cada sender exportado (al menos una invocación que termina en send)
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    NODE_ENV: 'production',
    RESEND_API_KEY: 're_env_key',
    EMAIL_FROM_ADDRESS: 'noreply@test.local',
  },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const resendSend = vi.hoisted(() => vi.fn())
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send: resendSend } })),
}))

// loadConfig lee de DB: getValue por key. Devolvemos null → fallback env,
// salvo sender_name para cubrir la rama "Name <email>".
const getValue = vi.hoisted(() => vi.fn())
vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn().mockResolvedValue({ query: vi.fn(), release: vi.fn() }) },
}))
vi.mock('../repositories/config.repository.js', () => ({ getValue }))
const renderTemplate = vi.hoisted(() => vi.fn())
vi.mock('../services/template-renderer.js', () => ({ renderTemplate }))

import * as svc from '../services/email.service.js'
import { logger } from '../lib/logger.js'

beforeEach(() => {
  vi.clearAllMocks()
  resendSend.mockResolvedValue({ data: { id: 'msg_1' }, error: null })
  renderTemplate.mockResolvedValue(null) // usa defaults inline
  getValue.mockResolvedValue(null)       // fallback a env
  svc.invalidateConfigCache()
})

describe('send (camino real Resend)', () => {
  it('envía con from = email (sin senderName) y loguea messageId', async () => {
    await svc.sendWelcomeEmail('u@x.com', 'aikikan')
    expect(resendSend).toHaveBeenCalledTimes(1)
    const payload = resendSend.mock.calls[0][0]
    expect(payload.from).toBe('noreply@test.local')
    expect(payload.to).toBe('u@x.com')
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'msg_1' }), 'Email sent')
  })

  it('from = "Name <email>" cuando hay sender_name en DB', async () => {
    getValue.mockImplementation(async (_c, key) => (key === 'sender_name' ? 'AppHub' : null))
    svc.invalidateConfigCache()
    await svc.sendWelcomeEmail('u@x.com', 'aikikan')
    expect(resendSend.mock.calls[0][0].from).toBe('AppHub <noreply@test.local>')
  })

  it('Resend devuelve error → logger.error, sin throw', async () => {
    resendSend.mockResolvedValue({ data: null, error: { message: 'bad' } })
    await svc.sendWelcomeEmail('u@x.com', 'aikikan')
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ err: { message: 'bad' } }), 'Failed to send email')
  })

  it('SDK lanza excepción → logger.error, sin throw', async () => {
    resendSend.mockRejectedValue(new Error('network'))
    await svc.sendWelcomeEmail('u@x.com', 'aikikan')
    expect(logger.error).toHaveBeenCalled()
  })

  it('replyTo se añade al payload (inquiry admin alert)', async () => {
    await svc.sendInquiryAdminAlert('admin@x.com', { contactName: 'Ana', email: 'ana@x.com', reference: 'R1', message: 'hola' })
    expect(resendSend.mock.calls[0][0].replyTo).toBe('ana@x.com')
  })

  it('compose: per-field fallback cuando DB trae html=null', async () => {
    renderTemplate.mockResolvedValue({ subject: 'S', text: 'T', html: null, locale: 'es' })
    await svc.sendWelcomeEmail('u@x.com', 'aikikan')
    const payload = resendSend.mock.calls[0][0]
    expect(payload.subject).toBe('S')
    expect(payload.html).toBeTruthy() // fallback al default inline
  })
})

describe('cobertura de todos los senders', () => {
  const date = '2026-06-01T10:00:00.000Z'
  const cases = [
    ['sendWelcomeEmail', ['u@x', 'aikikan']],
    ['sendPasswordResetEmail', ['u@x', 'http://r']],
    ['sendMagicLinkEmail', ['u@x', { displayName: 'Ann', magicLinkUrl: 'http://m' }]],
    ['sendMagicLinkEmail', ['u@x', undefined]],
    ['sendMagicLinkPendingApprovalEmail', ['u@x', { displayName: 'Ann' }]],
    ['sendMagicLinkPendingApprovalEmail', ['u@x', undefined]],
    ['sendDonationThankYou', ['u@x', { donorName: 'A', amountCents: 1000, causeName: 'C' }]],
    ['sendDonationThankYou', ['u@x', undefined]],
    ['sendDonationMonthlyReceipt', ['u@x', { amountCents: null }]],
    ['sendDonationPaymentFailed', ['u@x', { donorName: 'A', amountCents: 500 }]],
    ['sendDonationCancelled', ['u@x', { donorName: 'A' }]],
    ['sendDonationRefunded', ['u@x', { amountCents: 2000 }]],
    ['sendDonationCertificateReady', ['u@x', { year: 2025, certificateUrl: 'http://c' }]],
    ['sendSignupRequestedEmail', ['u@x', { displayName: 'A' }]],
    ['sendSignupApprovedEmail', ['u@x', { magicLinkUrl: 'http://m' }]],
    ['sendSignupRejectedEmail', ['u@x', { reason: 'spam' }]],
    ['sendSignupRejectedEmail', ['u@x', {}]],
    ['sendTenantBootstrapEmail', ['u@x', { ownerDisplayName: 'A', magicLinkUrl: 'http://m', expiresAt: date, appDisplayName: 'App', tenantDisplayName: 'T', locale: 'en' }]],
    ['sendTenantBootstrapEmail', ['u@x', { magicLinkUrl: 'http://m', locale: 'es' }]],
    ['sendTenantActivatedEmail', ['u@x', { locale: 'en' }]],
    ['sendTenantActivatedEmail', ['u@x', undefined]],
    ['sendBookingReminderEmail', ['u@x', { name: 'A', startsAt: date, window: 't_minus_24h' }]],
    ['sendBookingReminderEmail', ['u@x', { startsAt: date, window: 't_minus_2h', locale: 'en' }]],
    ['sendReservationReminderEmail', ['u@x', { name: 'A', reservedFor: date, partySize: 4, window: 't_minus_2h' }]],
    ['sendPackageExpiryEmail', ['u@x', { remainingSessions: 2, expiresAt: date, window: 't_minus_30d' }]],
    ['sendPackageExpiryEmail', ['u@x', { remainingSessions: 1, expiresAt: date, window: 't_minus_7d', locale: 'en' }]],
    ['sendDisputeSlaInternalEmail', ['u@x', { disputeId: 'd1', orderId: 'o1', openedAt: date }]],
    ['sendBookingConfirmedEmail', ['u@x', { name: 'A', startsAt: date, locale: 'en' }]],
    ['sendBookingConfirmedEmail', ['u@x', { startsAt: date }]],
    ['sendBookingCancelledEmail', ['u@x', { name: 'A', startsAt: date, reason: 'x', locale: 'en' }]],
    ['sendBookingCancelledEmail', ['u@x', { startsAt: date }]],
    ['sendBookingRescheduledEmail', ['u@x', { name: 'A', startsAt: date, locale: 'en' }]],
    ['sendBookingRescheduledEmail', ['u@x', { startsAt: date }]],
    ['sendReservationCreatedEmail', ['u@x', { name: 'A', reservedFor: date, partySize: 2, locale: 'en' }]],
    ['sendReservationCreatedEmail', ['u@x', { reservedFor: date, partySize: 2 }]],
    ['sendReservationCancelledEmail', ['u@x', { name: 'A', reservedFor: date, locale: 'en' }]],
    ['sendReservationCancelledEmail', ['u@x', { reservedFor: date }]],
    ['sendPackageExhaustedEmail', ['u@x', { locale: 'en' }]],
    ['sendPackageExhaustedEmail', ['u@x', undefined]],
    ['sendBasketAbandonedEmail', ['u@x', { itemCount: 1, locale: 'en' }]],
    ['sendBasketAbandonedEmail', ['u@x', { itemCount: 1 }]],
    ['sendBasketAbandonedEmail', ['u@x', { itemCount: 3, locale: 'en' }]],
    ['sendBasketAbandonedEmail', ['u@x', { itemCount: 3 }]],
    ['sendOrderPaidEmail', ['u@x', { orderId: 'o1', totalCents: 1500, currency: 'EUR', locale: 'en' }]],
    ['sendOrderPaidEmail', ['u@x', { orderId: 'o1', totalCents: 1500, currency: 'EUR' }]],
    ['sendOrderPaidEmail', ['u@x', { orderId: 'o1', totalCents: null }]],
    ['sendOrderShippedEmail', ['u@x', { orderId: 'o1', trackingCode: 'TR', carrier: 'UPS', locale: 'en' }]],
    ['sendOrderShippedEmail', ['u@x', { orderId: 'o1', trackingCode: 'TR', carrier: 'UPS' }]],
    ['sendOrderShippedEmail', ['u@x', { orderId: 'o1', trackingCode: 'TR' }]],
    ['sendOrderShippedEmail', ['u@x', { orderId: 'o1', trackingCode: 'TR', locale: 'en' }]],
    ['sendOrderShippedEmail', ['u@x', { orderId: 'o1', locale: 'en' }]],
    ['sendOrderShippedEmail', ['u@x', { orderId: 'o1' }]],
    ['sendOrderDeliveredEmail', ['u@x', { orderId: 'o1', locale: 'en' }]],
    ['sendOrderDeliveredEmail', ['u@x', { orderId: 'o1' }]],
    ['sendOrderCancelledEmail', ['u@x', { orderId: 'o1', reason: 'x', locale: 'en' }]],
    ['sendOrderCancelledEmail', ['u@x', { orderId: 'o1', reason: 'x' }]],
    ['sendOrderCancelledEmail', ['u@x', { orderId: 'o1', locale: 'en' }]],
    ['sendOrderCancelledEmail', ['u@x', { orderId: 'o1' }]],
    ['sendOrderRefundedEmail', ['u@x', { orderId: 'o1', totalCents: 99, currency: 'USD', locale: 'en' }]],
    ['sendOrderRefundedEmail', ['u@x', { orderId: 'o1', totalCents: 99, currency: 'USD' }]],
    ['sendPayoutPaidEmail', ['u@x', { amount: '10€', periodLabel: 'May', externalRef: 'ref', locale: 'en' }]],
    ['sendPayoutPaidEmail', ['u@x', { amount: '10€', periodLabel: 'May', externalRef: 'ref' }]],
    ['sendInquiryAdminAlert', ['u@x', { contactName: 'A', email: 'a@x', reference: 'R', message: 'm', phone: '600', subject: 'S' }]],
    ['sendInquiryAdminAlert', ['u@x', {}]],
    ['sendInquiryUserThankYou', ['u@x', { contactName: 'A', reference: 'R', replyToEmail: 'r@x' }]],
    ['sendInquiryUserThankYou', ['u@x', { contactName: 'A', reference: 'R', contactInboxEmail: 'i@x' }]],
    ['sendInquiryUserThankYou', ['u@x', {}]],
    ['sendRaw', [{ to: 'u@x', subject: 'S', text: 'T', html: 'H' }]],
  ]

  it.each(cases)('%s no lanza y llama send', async (fn, args) => {
    await expect(svc[fn](...args)).resolves.not.toThrow()
    expect(resendSend).toHaveBeenCalled()
  })
})

describe('formatAmount fallback', () => {
  it('currency inválida → cae al catch de Intl', async () => {
    await svc.sendOrderPaidEmail('u@x', { orderId: 'o', totalCents: 100, currency: 'NOPE' })
    expect(resendSend).toHaveBeenCalled()
  })
})
