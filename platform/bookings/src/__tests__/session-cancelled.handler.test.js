// session-cancelled.handler — subscriber que cancela en masa las bookings de
// una session cancelada por el admin. Captura el callback de subscribe() y lo
// invoca con eventos crudos.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { subscribeMock, publishMock, withTxMock } = vi.hoisted(() => ({
  subscribeMock: vi.fn(),
  publishMock: vi.fn(),
  withTxMock: vi.fn(),
}))
vi.mock('../lib/redis.js', () => ({ subscribe: subscribeMock, publish: publishMock }))
vi.mock('../lib/db.js', () => ({ pool: { connect: vi.fn() }, withTenantTransaction: withTxMock }))

import { startSessionCancelledSubscriber } from '../events/session-cancelled.handler.js'
import { logger } from '../lib/logger.js'

const APP = 'yoga'
const TENANT = 't1'
const SESS = 'sess1'

function mockClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

let handler
beforeEach(() => {
  vi.clearAllMocks()
  withTxMock.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
  startSessionCancelledSubscriber()
  handler = subscribeMock.mock.calls[0][0]
})

it('registra el subscriber', () => {
  expect(subscribeMock).toHaveBeenCalledOnce()
})

it('JSON inválido → ignora silenciosamente', async () => {
  await handler('chan', 'not-json{')
  expect(withTxMock).not.toHaveBeenCalled()
})

it('tipo de evento distinto → no hace nada', async () => {
  await handler('chan', JSON.stringify({ type: 'other.event', payload: {} }))
  expect(withTxMock).not.toHaveBeenCalled()
})

it('payload incompleto (sin sessionId) → 0, sin tx', async () => {
  await handler('chan', JSON.stringify({ type: 'service.session.cancelled', payload: { appId: APP, tenantId: TENANT } }))
  expect(withTxMock).not.toHaveBeenCalled()
})

it('cancela bookings vivas + emite booking.cancelled por cada una', async () => {
  withTxMock.mockImplementation(async (_p, _a, _t, _s, fn) =>
    fn(mockClient([
      { id: 'b1', client_user_id: 'u1', starts_at: 'S1' },
      { id: 'b2', client_user_id: 'u2', starts_at: 'S2' },
    ])),
  )
  await handler('chan', JSON.stringify({
    type: 'service.session.cancelled',
    payload: { appId: APP, tenantId: TENANT, sessionId: SESS },
  }))
  expect(publishMock).toHaveBeenCalledTimes(2)
  expect(publishMock).toHaveBeenCalledWith(expect.objectContaining({
    type: 'booking.cancelled',
    payload: expect.objectContaining({ bookingId: 'b1', sessionId: SESS, reason: 'session_cancelled' }),
  }))
  expect(logger.info).toHaveBeenCalled()
})

it('0 bookings afectadas → no loguea info', async () => {
  withTxMock.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient([])))
  await handler('chan', JSON.stringify({
    type: 'service.session.cancelled',
    payload: { appId: APP, tenantId: TENANT, sessionId: SESS },
  }))
  expect(publishMock).not.toHaveBeenCalled()
  expect(logger.info).not.toHaveBeenCalled()
})

it('error en la tx → loguea error, no propaga', async () => {
  withTxMock.mockRejectedValue(new Error('db down'))
  await handler('chan', JSON.stringify({
    type: 'service.session.cancelled',
    payload: { appId: APP, tenantId: TENANT, sessionId: SESS },
  }))
  expect(logger.error).toHaveBeenCalled()
})
