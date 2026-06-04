// waitlist-promotion.handler — subscriber que promueve la entrada de waitlist
// más antigua cuando un slot se libera (booking.cancelled / booking.rescheduled).
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
vi.mock('../repositories/bookings.repository.js')

import { startWaitlistPromotionSubscriber } from '../events/waitlist-promotion.handler.js'
import * as repo from '../repositories/bookings.repository.js'
import { logger } from '../lib/logger.js'

const APP = 'yoga'
const TENANT = 't1'
const SVC = 'svc1'
const RES = 'res1'

function mockClient() { return { query: vi.fn().mockResolvedValue({ rows: [] }) } }

let handler
beforeEach(() => {
  vi.clearAllMocks()
  withTxMock.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
  startWaitlistPromotionSubscriber()
  handler = subscribeMock.mock.calls[0][0]
})

it('registra el subscriber', () => {
  expect(subscribeMock).toHaveBeenCalledOnce()
})

it('JSON inválido → ignora', async () => {
  await handler('chan', 'not-json{')
  expect(withTxMock).not.toHaveBeenCalled()
})

it('tipo de evento irrelevante → no hace nada', async () => {
  await handler('chan', JSON.stringify({ type: 'booking.confirmed', payload: { appId: APP, tenantId: TENANT, serviceId: SVC } }))
  expect(withTxMock).not.toHaveBeenCalled()
})

it('payload sin serviceId → no promueve', async () => {
  await handler('chan', JSON.stringify({ type: 'booking.cancelled', payload: { appId: APP, tenantId: TENANT } }))
  expect(withTxMock).not.toHaveBeenCalled()
  expect(publishMock).not.toHaveBeenCalled()
})

it('booking.cancelled con recurso → promueve por recurso + publica notified', async () => {
  repo.promoteOldestWaiting.mockResolvedValue({
    id: 'w1', service_id: SVC, resource_id: RES, client_user_id: 'u1', client_phone: '+34600',
  })
  await handler('chan', JSON.stringify({
    type: 'booking.cancelled',
    payload: { appId: APP, tenantId: TENANT, serviceId: SVC, resourceIds: [RES] },
  }))
  expect(repo.promoteOldestWaiting).toHaveBeenCalledWith(
    expect.anything(), APP, TENANT, { serviceId: SVC, resourceId: RES },
  )
  expect(publishMock).toHaveBeenCalledWith(expect.objectContaining({
    type: 'booking.waitlist.notified',
    payload: expect.objectContaining({
      waitlistId: 'w1', serviceId: SVC, resourceId: RES,
      clientUserId: 'u1', clientPhone: '+34600', freedBy: 'booking.cancelled',
    }),
  }))
  expect(logger.info).toHaveBeenCalled()
})

it('booking.rescheduled sin recursos → promueve entrada genérica (resourceId undefined)', async () => {
  repo.promoteOldestWaiting.mockResolvedValue({
    id: 'w2', service_id: SVC, resource_id: null, client_user_id: 'u2', client_phone: null,
  })
  await handler('chan', JSON.stringify({
    type: 'booking.rescheduled',
    payload: { appId: APP, tenantId: TENANT, serviceId: SVC },
  }))
  expect(repo.promoteOldestWaiting).toHaveBeenCalledWith(
    expect.anything(), APP, TENANT, { serviceId: SVC, resourceId: undefined },
  )
  expect(publishMock).toHaveBeenCalledWith(expect.objectContaining({
    type: 'booking.waitlist.notified',
    payload: expect.objectContaining({ waitlistId: 'w2', freedBy: 'booking.rescheduled' }),
  }))
})

it('sin entradas waiting → no publica, no loguea', async () => {
  repo.promoteOldestWaiting.mockResolvedValue(null)
  await handler('chan', JSON.stringify({
    type: 'booking.cancelled',
    payload: { appId: APP, tenantId: TENANT, serviceId: SVC, resourceIds: [RES] },
  }))
  expect(publishMock).not.toHaveBeenCalled()
  expect(logger.info).not.toHaveBeenCalled()
})

it('varios recursos liberados → intenta promover por cada uno', async () => {
  repo.promoteOldestWaiting
    .mockResolvedValueOnce({ id: 'w1', service_id: SVC, resource_id: 'rA', client_user_id: 'u1' })
    .mockResolvedValueOnce(null)
  await handler('chan', JSON.stringify({
    type: 'booking.cancelled',
    payload: { appId: APP, tenantId: TENANT, serviceId: SVC, resourceIds: ['rA', 'rB'] },
  }))
  expect(repo.promoteOldestWaiting).toHaveBeenCalledTimes(2)
  expect(publishMock).toHaveBeenCalledTimes(1)
})

it('error en la tx → loguea error, no propaga', async () => {
  withTxMock.mockRejectedValue(new Error('db down'))
  await handler('chan', JSON.stringify({
    type: 'booking.cancelled',
    payload: { appId: APP, tenantId: TENANT, serviceId: SVC, resourceIds: [RES] },
  }))
  expect(logger.error).toHaveBeenCalled()
})
