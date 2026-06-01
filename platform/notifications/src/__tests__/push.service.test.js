// push.service — FCM HTTP v1 sender. Cubre stub-mode, JSON inválido del SA,
// firma JWT + OAuth token exchange (cacheado), envío por token, poda de
// tokens muertos (UNREGISTERED/404), error de token-fetch, y los senders
// compose-based. Genera un par RSA real para que crypto.sign funcione.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'node:crypto'

const env = vi.hoisted(() => ({ NODE_ENV: 'production' }))
vi.mock('../lib/env.js', () => ({ env }))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
const getValue = vi.hoisted(() => vi.fn())
const withTenantTransaction = vi.hoisted(() => vi.fn())
const poolConnect = vi.hoisted(() => vi.fn())
vi.mock('../lib/db.js', () => ({
  pool: { connect: poolConnect },
  withTenantTransaction,
}))
vi.mock('../repositories/config.repository.js', () => ({ getValue }))
const pushRepo = vi.hoisted(() => ({ tokensForUser: vi.fn(), deleteByToken: vi.fn() }))
vi.mock('../repositories/push-devices.repository.js', () => pushRepo)
const renderTemplate = vi.hoisted(() => vi.fn())
vi.mock('../services/template-renderer.js', () => ({ renderTemplate }))

import * as push from '../services/push.service.js'
import { logger } from '../lib/logger.js'

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' })
const SA = JSON.stringify({
  client_email: 'svc@proj.iam.gserviceaccount.com',
  private_key_id: 'kid1',
  private_key: PEM,
})

const ctx = { appId: 'aikikan', tenantId: 't1', subTenantId: null }

function configured(json = SA) {
  getValue.mockImplementation(async (_c, key) => {
    if (key === 'fcm_project_id') return 'proj-1'
    if (key === 'fcm_service_account_json') return json
    return null
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  env.NODE_ENV = 'production'
  renderTemplate.mockResolvedValue(null)
  push.invalidatePushConfigCache()
  poolConnect.mockResolvedValue({ query: vi.fn(), release: vi.fn() })
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn({}))
})

describe('stub mode', () => {
  it('sin config → { stub:true }', async () => {
    getValue.mockResolvedValue(null)
    const r = await push.sendPushToUser(ctx, 'u1', { title: 'T', body: 'B' })
    expect(r).toEqual({ stub: true })
  })

  it('NODE_ENV=test → stub', async () => {
    env.NODE_ENV = 'test'
    configured()
    push.invalidatePushConfigCache()
    expect(await push.sendPushToUser(ctx, 'u1', { title: 'T', body: 'B' })).toEqual({ stub: true })
  })

  it('SA JSON inválido → loguea error y queda en stub (serviceAccount null)', async () => {
    configured('{not-json')
    push.invalidatePushConfigCache()
    const r = await push.sendPushToUser(ctx, 'u1', { title: 'T', body: 'B' })
    expect(logger.error).toHaveBeenCalled()
    expect(r).toEqual({ stub: true })
  })
})

describe('envío real', () => {
  beforeEach(() => { configured(); push.invalidatePushConfigCache() })

  it('sin tokens → { sent: 0 }', async () => {
    pushRepo.tokensForUser.mockResolvedValue([])
    const r = await push.sendPushToUser(ctx, 'u1', { title: 'T', body: 'B' })
    expect(r).toEqual({ sent: 0 })
  })

  it('token-fetch falla (OAuth no-ok) → { error }', async () => {
    pushRepo.tokensForUser.mockResolvedValue([{ token: 'tok1' }])
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'denied' })
    const r = await push.sendPushToUser(ctx, 'u1', { title: 'T', body: 'B' })
    expect(r.error).toMatch(/OAuth2 token exchange failed/)
  })

  it('envía a 1 token OK; data se stringifica', async () => {
    pushRepo.tokensForUser.mockResolvedValue([{ token: 'tok1' }])
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'at', expires_in: 3600 }) }) // token
      .mockResolvedValueOnce({ ok: true, json: async () => ({ name: 'projects/x/messages/1' }) })          // send
    const r = await push.sendPushToUser(ctx, 'u1', { title: 'T', body: 'B', data: { type: 'x', n: 5 } })
    expect(r).toEqual({ sent: 1, dead: 0 })
    const sendBody = JSON.parse(global.fetch.mock.calls[1][1].body)
    expect(sendBody.message.data).toEqual({ type: 'x', n: '5' })
  })

  it('token muerto (UNREGISTERED) → se poda con deleteByToken', async () => {
    pushRepo.tokensForUser.mockResolvedValue([{ token: 'dead' }])
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'at', expires_in: 3600 }) })
      .mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'UNREGISTERED' })
    const r = await push.sendPushToUser(ctx, 'u1', { title: 'T', body: 'B' })
    expect(r).toEqual({ sent: 0, dead: 1 })
    expect(pushRepo.deleteByToken).toHaveBeenCalledWith(expect.anything(), 'dead')
  })

  it('error no-mortal → logger.warn, sin poda', async () => {
    pushRepo.tokensForUser.mockResolvedValue([{ token: 'tok1' }])
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'at', expires_in: 3600 }) })
      .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'ISE', text: async () => '' })
    const r = await push.sendPushToUser(ctx, 'u1', { title: 'T', body: 'B' })
    expect(r).toEqual({ sent: 0, dead: 0 })
    expect(logger.warn).toHaveBeenCalled()
    expect(pushRepo.deleteByToken).not.toHaveBeenCalled()
  })

  it('access token cacheado → no re-fetch en segundo envío', async () => {
    pushRepo.tokensForUser.mockResolvedValue([{ token: 'tok1' }])
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'at', expires_in: 3600 }) })
      .mockResolvedValue({ ok: true, json: async () => ({ name: 'n' }) })
    await push.sendPushToUser(ctx, 'u1', { title: 'T', body: 'B' })
    const callsAfterFirst = global.fetch.mock.calls.length
    await push.sendPushToUser(ctx, 'u1', { title: 'T', body: 'B' })
    // Segundo envío: solo 1 fetch nuevo (send), sin token exchange.
    expect(global.fetch.mock.calls.length).toBe(callsAfterFirst + 1)
  })
})

describe('senders compose-based', () => {
  const date = '2026-06-01T10:00:00.000Z'
  beforeEach(() => {
    configured(); push.invalidatePushConfigCache()
    pushRepo.tokensForUser.mockResolvedValue([{ token: 'tok1' }])
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'at', expires_in: 3600 }) })
      .mockResolvedValue({ ok: true, json: async () => ({ name: 'n' }) })
  })

  const cases = [
    ['sendBookingReminderPush', [ctx, 'u1', { startsAt: date, window: 't_minus_24h' }]],
    ['sendBookingReminderPush', [ctx, 'u1', { startsAt: date, window: 't_minus_2h' }]],
    ['sendBookingReminderPush', [ctx, 'u1', { startsAt: date, window: 't_minus_24h', locale: 'en' }]],
    ['sendBookingReminderPush', [ctx, 'u1', { startsAt: date, window: 't_minus_2h', locale: 'en' }]],
    ['sendBookingConfirmedPush', [ctx, 'u1', { startsAt: date, locale: 'en' }]],
    ['sendBookingConfirmedPush', [ctx, 'u1', { startsAt: date }]],
    ['sendReservationReminderPush', [ctx, 'u1', { reservedFor: date, partySize: 2, window: 't_minus_24h', locale: 'en' }]],
    ['sendReservationReminderPush', [ctx, 'u1', { reservedFor: date, partySize: 2, window: 't_minus_2h', locale: 'en' }]],
    ['sendReservationReminderPush', [ctx, 'u1', { reservedFor: date, partySize: 2, window: 't_minus_24h' }]],
    ['sendReservationReminderPush', [ctx, 'u1', { reservedFor: date, partySize: 2, window: 't_minus_2h' }]],
  ]

  it.each(cases)('%s', async (fn, args) => {
    const r = await push[fn](...args)
    expect(r.sent).toBe(1)
  })

  it('compose usa DB template si existe', async () => {
    renderTemplate.mockResolvedValue({ subject: 'DBsubj', text: 'DBtext' })
    await push.sendBookingConfirmedPush(ctx, 'u1', { startsAt: date })
    const sendBody = JSON.parse(global.fetch.mock.calls[1][1].body)
    expect(sendBody.message.notification.title).toBe('DBsubj')
  })
})
