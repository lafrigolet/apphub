// sms.service — Twilio sender. Cubre stub-mode (sin creds → log), envío real
// (fetch OK con MessagingService o From), respuesta no-ok, excepción de fetch,
// to/body vacío, y los senders compose-based (booking/reservation x estados).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const env = vi.hoisted(() => ({ NODE_ENV: 'production', LOG_LEVEL: 'silent' }))
vi.mock('../lib/env.js', () => ({ env }))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
const getValue = vi.hoisted(() => vi.fn())
vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn().mockResolvedValue({ query: vi.fn(), release: vi.fn() }) },
}))
vi.mock('../repositories/config.repository.js', () => ({ getValue }))
const renderTemplate = vi.hoisted(() => vi.fn())
vi.mock('../services/template-renderer.js', () => ({ renderTemplate }))
// Suppression gate mocked off (covered in suppression.service.test.js).
const isSuppressed = vi.hoisted(() => vi.fn().mockResolvedValue(false))
vi.mock('../services/suppression.service.js', () => ({ isSuppressed }))

import * as sms from '../services/sms.service.js'
import { logger } from '../lib/logger.js'

// Config completa con MessagingService (rama 1) o sólo From (rama 2).
function fullConfig({ withMsgService = true } = {}) {
  const map = {
    twilio_account_sid: 'AC123',
    twilio_api_key_sid: 'SK123',
    twilio_api_key_secret: 'secret',
    twilio_messaging_service_sid: withMsgService ? 'MG123' : null,
    twilio_default_sender: withMsgService ? null : '+34600000000',
  }
  getValue.mockImplementation(async (_c, key) => map[key] ?? null)
}

beforeEach(() => {
  vi.clearAllMocks()
  env.NODE_ENV = 'production'
  renderTemplate.mockResolvedValue(null)
  sms.invalidateSmsConfigCache()
  global.fetch = vi.fn()
})

describe('stub mode', () => {
  it('sin creds → { stub:true } y log, no fetch', async () => {
    getValue.mockResolvedValue(null)
    const r = await sms.sendTestSms('+34600111222')
    expect(r).toEqual({ stub: true })
    expect(global.fetch).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalled()
  })

  it('NODE_ENV=test fuerza stub aunque haya creds', async () => {
    env.NODE_ENV = 'test'
    fullConfig()
    sms.invalidateSmsConfigCache()
    const r = await sms.sendTestSms('+34600111222', 'hola')
    expect(r).toEqual({ stub: true })
  })
})

describe('envío real', () => {
  it('MessagingServiceSid → fetch OK devuelve sid', async () => {
    fullConfig({ withMsgService: true })
    sms.invalidateSmsConfigCache()
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ sid: 'SM1' }) })
    const r = await sms.sendTestSms('+34600111222', 'hi')
    expect(r).toEqual({ sid: 'SM1' })
    const body = global.fetch.mock.calls[0][1].body
    expect(body).toContain('MessagingServiceSid=MG123')
  })

  it('sin MessagingService usa From=default_sender', async () => {
    fullConfig({ withMsgService: false })
    sms.invalidateSmsConfigCache()
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ sid: 'SM2' }) })
    await sms.sendTestSms('+34600111222', 'hi')
    expect(global.fetch.mock.calls[0][1].body).toContain('From=')
  })

  it('respuesta no-ok → { error }', async () => {
    fullConfig()
    sms.invalidateSmsConfigCache()
    global.fetch.mockResolvedValue({ ok: false, status: 400, statusText: 'Bad', text: async () => 'err-detail' })
    const r = await sms.sendTestSms('+34600111222', 'hi')
    expect(r).toEqual({ error: 'err-detail' })
    expect(logger.error).toHaveBeenCalled()
  })

  it('respuesta no-ok sin texto → usa statusText', async () => {
    fullConfig()
    sms.invalidateSmsConfigCache()
    global.fetch.mockResolvedValue({ ok: false, status: 500, statusText: 'Boom', text: async () => { throw new Error('x') } })
    const r = await sms.sendTestSms('+34600111222', 'hi')
    expect(r).toEqual({ error: 'Boom' })
  })

  it('fetch lanza → { error: message }', async () => {
    fullConfig()
    sms.invalidateSmsConfigCache()
    global.fetch.mockRejectedValue(new Error('network'))
    const r = await sms.sendTestSms('+34600111222', 'hi')
    expect(r).toEqual({ error: 'network' })
  })
})

describe('senders compose-based', () => {
  const date = '2026-06-01T10:00:00.000Z'
  beforeEach(() => {
    fullConfig()
    sms.invalidateSmsConfigCache()
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ sid: 'SMx' }) })
  })

  const cases = [
    ['sendBookingReminderSms', ['+34600', { name: 'A', startsAt: date, window: 't_minus_24h' }]],
    ['sendBookingReminderSms', ['+34600', { startsAt: date, window: 't_minus_2h' }]],
    ['sendBookingReminderSms', ['+34600', { startsAt: date, window: 't_minus_24h', locale: 'en' }]],
    ['sendBookingReminderSms', ['+34600', { startsAt: date, window: 't_minus_2h', locale: 'en' }]],
    ['sendReservationReminderSms', ['+34600', { name: 'A', reservedFor: date, partySize: 2, window: 't_minus_24h', locale: 'en' }]],
    ['sendReservationReminderSms', ['+34600', { reservedFor: date, partySize: 2, window: 't_minus_2h', locale: 'en' }]],
    ['sendReservationReminderSms', ['+34600', { reservedFor: date, partySize: 2, window: 't_minus_24h' }]],
    ['sendReservationReminderSms', ['+34600', { reservedFor: date, partySize: 2, window: 't_minus_2h' }]],
    ['sendBookingConfirmedSms', ['+34600', { startsAt: date, locale: 'en' }]],
    ['sendBookingConfirmedSms', ['+34600', { startsAt: date }]],
    ['sendBookingCancelledSms', ['+34600', { startsAt: date, locale: 'en' }]],
    ['sendBookingCancelledSms', ['+34600', { startsAt: date }]],
    ['sendBookingRescheduledSms', ['+34600', { startsAt: date, locale: 'en' }]],
    ['sendBookingRescheduledSms', ['+34600', { startsAt: date }]],
    ['sendReservationCancelledSms', ['+34600', { reservedFor: date, locale: 'en' }]],
    ['sendReservationCancelledSms', ['+34600', { reservedFor: date }]],
  ]

  it.each(cases)('%s envía via fetch', async (fn, args) => {
    await sms[fn](...args)
    expect(global.fetch).toHaveBeenCalled()
  })

  it('compose usa template de DB si existe', async () => {
    renderTemplate.mockResolvedValue({ text: 'DB body' })
    await sms.sendBookingConfirmedSms('+34600', { startsAt: date })
    expect(global.fetch.mock.calls[0][1].body).toContain('DB+body')
  })
})
