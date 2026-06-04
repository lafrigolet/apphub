// Wiring de los tres senders → logSend (send-log.service mockeado).
// Cubre: email sent/failed/skipped (templateKey viaja desde compose),
// sms skipped con templateKey, push skipped con tenant context completo.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// NODE_ENV='production' para que email no entre en skip-por-test; la API key
// llega (o no) vía getValue, controlada por test.
vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'production', EMAIL_FROM_ADDRESS: 'noreply@test.local' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const logSend = vi.hoisted(() => vi.fn())
vi.mock('../services/send-log.service.js', () => ({ logSend }))

const resendSend = vi.hoisted(() => vi.fn())
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send: resendSend } })),
}))

const getValue = vi.hoisted(() => vi.fn())
vi.mock('../repositories/config.repository.js', () => ({ getValue }))
const renderTemplate = vi.hoisted(() => vi.fn())
vi.mock('../services/template-renderer.js', () => ({ renderTemplate }))

const withTenantTransaction = vi.hoisted(() => vi.fn())
vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn().mockResolvedValue({ query: vi.fn(), release: vi.fn() }) },
  withTenantTransaction,
}))
vi.mock('../repositories/push-devices.repository.js', () => ({
  tokensForUser: vi.fn(), deleteByToken: vi.fn(),
}))

import * as emailSvc from '../services/email.service.js'
import * as smsSvc from '../services/sms.service.js'
import * as pushSvc from '../services/push.service.js'

beforeEach(() => {
  vi.clearAllMocks()
  renderTemplate.mockResolvedValue(null)   // defaults inline → templateKey igualmente
  getValue.mockResolvedValue(null)         // sin credenciales salvo override por test
  resendSend.mockResolvedValue({ data: { id: 'msg_1' }, error: null })
  emailSvc.invalidateConfigCache()
  smsSvc.invalidateSmsConfigCache()
  pushSvc.invalidatePushConfigCache()
})

const withResendKey = () => {
  getValue.mockImplementation(async (_c, key) => (key === 'resend_api_key' ? 're_db_key' : null))
  emailSvc.invalidateConfigCache()
}

describe('email → send_log', () => {
  it('envío OK → status sent, channel email, templateKey de compose', async () => {
    withResendKey()
    await emailSvc.sendWelcomeEmail('u@x.com', 'aikikan')
    expect(logSend).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'email', template: 'user.welcome', recipient: 'u@x.com', status: 'sent',
    }))
  })

  it('Resend devuelve error → status failed con mensaje', async () => {
    withResendKey()
    resendSend.mockResolvedValue({ data: null, error: { message: 'bad domain' } })
    await emailSvc.sendPasswordResetEmail('u@x.com', 'https://r')
    expect(logSend).toHaveBeenCalledWith(expect.objectContaining({
      template: 'auth.password_reset', status: 'failed', error: 'bad domain',
    }))
  })

  it('SDK lanza → status failed', async () => {
    withResendKey()
    resendSend.mockRejectedValue(new Error('network'))
    await emailSvc.sendWelcomeEmail('u@x.com', 'aikikan')
    expect(logSend).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', error: 'network' }))
  })

  it('sin API key → status skipped (dev-stub)', async () => {
    await emailSvc.sendWelcomeEmail('u@x.com', 'aikikan')
    expect(resendSend).not.toHaveBeenCalled()
    expect(logSend).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'email', template: 'user.welcome', status: 'skipped',
    }))
  })
})

describe('sms → send_log', () => {
  it('stub (sin credenciales Twilio) → skipped con templateKey', async () => {
    await smsSvc.sendBookingConfirmedSms('+34600000000', { startsAt: '2026-06-10T10:00:00Z' })
    expect(logSend).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'sms', template: 'booking.confirmed', recipient: '+34600000000', status: 'skipped',
    }))
  })
})

describe('push → send_log', () => {
  it('stub (sin FCM) → skipped con tenant context completo', async () => {
    const ctx = { appId: 'aikikan', tenantId: 't1', subTenantId: null }
    await pushSvc.sendBookingConfirmedPush(ctx, 'u1', { startsAt: '2026-06-10T10:00:00Z' })
    expect(logSend).toHaveBeenCalledWith(expect.objectContaining({
      appId: 'aikikan', tenantId: 't1', userId: 'u1',
      channel: 'push', template: 'booking.confirmed', recipient: 'u1', status: 'skipped',
    }))
  })

  it('FCM configurado pero usuario sin devices → skipped "no registered devices"', async () => {
    getValue.mockImplementation(async (_c, key) => {
      if (key === 'fcm_project_id') return 'proj'
      if (key === 'fcm_service_account_json') return JSON.stringify({ client_email: 'a@b', private_key: 'k', private_key_id: 'id' })
      return null
    })
    pushSvc.invalidatePushConfigCache()
    withTenantTransaction.mockResolvedValue([])
    const ctx = { appId: 'aikikan', tenantId: 't1', subTenantId: null }
    await pushSvc.sendPushToUser(ctx, 'u1', { title: 't', body: 'b', data: { type: 'chat.message' } })
    expect(logSend).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'push', template: 'chat.message', status: 'skipped', error: 'no registered devices',
    }))
  })
})
