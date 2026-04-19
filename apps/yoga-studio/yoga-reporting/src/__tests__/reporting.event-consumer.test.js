import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { REDIS_URL: 'redis://localhost:6379', YOGA_TENANT_ID: '00000000-0000-0000-0000-000000000001' },
}))

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn() },
  setTenantContext: vi.fn(),
}))

vi.mock('../repositories/reporting.repository.js')

vi.mock('ioredis', () => {
  const MockRedis = vi.fn(() => ({
    subscribe: vi.fn((ch, cb) => cb(null)),
    on: vi.fn(),
  }))
  return { default: MockRedis }
})

import { startEventConsumer } from '../services/event-consumer.js'
import { pool, setTenantContext } from '../lib/db.js'
import * as reportRepo from '../repositories/reporting.repository.js'
import Redis from 'ioredis'

const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const USER_ID = '11111111-1111-1111-1111-111111111111'

function setupConsumer() {
  let messageHandler
  const redisMock = {
    subscribe: vi.fn((ch, cb) => cb(null)),
    on: vi.fn((event, handler) => {
      if (event === 'message') messageHandler = handler
    }),
  }
  Redis.mockReturnValue(redisMock)

  const mockClient = { query: vi.fn(), release: vi.fn() }
  pool.connect.mockResolvedValue(mockClient)
  setTenantContext.mockResolvedValue()
  reportRepo.upsertDailyMetric.mockResolvedValue()

  startEventConsumer()
  return { messageHandler, mockClient }
}

beforeEach(() => vi.clearAllMocks())

describe('event-consumer (yoga-reporting)', () => {
  it('increments total_bookings on booking.created', async () => {
    const { messageHandler } = setupConsumer()

    const event = { type: 'booking.created', payload: { userId: USER_ID, tenantId: TENANT_ID } }
    await messageHandler('yoga:events', JSON.stringify(event))

    expect(reportRepo.upsertDailyMetric).toHaveBeenCalledWith(
      expect.anything(), TENANT_ID, expect.any(String), 'total_bookings',
    )
  })

  it('decrements total_bookings on booking.cancelled', async () => {
    const { messageHandler } = setupConsumer()

    const event = { type: 'booking.cancelled', payload: { userId: USER_ID, tenantId: TENANT_ID } }
    await messageHandler('yoga:events', JSON.stringify(event))

    expect(reportRepo.upsertDailyMetric).toHaveBeenCalledWith(
      expect.anything(), TENANT_ID, expect.any(String), 'total_bookings', -1,
    )
  })

  it('increments total_attended on booking.attended', async () => {
    const { messageHandler } = setupConsumer()

    const event = { type: 'booking.attended', payload: { userId: USER_ID, tenantId: TENANT_ID } }
    await messageHandler('yoga:events', JSON.stringify(event))

    expect(reportRepo.upsertDailyMetric).toHaveBeenCalledWith(
      expect.anything(), TENANT_ID, expect.any(String), 'total_attended',
    )
  })

  it('increments total_no_show on no-show.detected', async () => {
    const { messageHandler } = setupConsumer()

    const event = { type: 'no-show.detected', payload: { userId: USER_ID, tenantId: TENANT_ID } }
    await messageHandler('yoga:events', JSON.stringify(event))

    expect(reportRepo.upsertDailyMetric).toHaveBeenCalledWith(
      expect.anything(), TENANT_ID, expect.any(String), 'total_no_show',
    )
  })

  it('skips events without tenantId', async () => {
    const { messageHandler } = setupConsumer()

    const event = { type: 'booking.created', payload: { userId: USER_ID } }
    await messageHandler('yoga:events', JSON.stringify(event))

    expect(reportRepo.upsertDailyMetric).not.toHaveBeenCalled()
  })

  it('sets tenant context on the DB client', async () => {
    const { messageHandler, mockClient } = setupConsumer()

    const event = { type: 'booking.created', payload: { userId: USER_ID, tenantId: TENANT_ID } }
    await messageHandler('yoga:events', JSON.stringify(event))

    const [calledClient, calledTenant] = setTenantContext.mock.calls[0]
    expect(calledClient).toBe(mockClient)
    expect(calledTenant).toBe(TENANT_ID)
  })

  it('releases client even when repo throws', async () => {
    const { messageHandler, mockClient } = setupConsumer()
    reportRepo.upsertDailyMetric.mockRejectedValue(new Error('DB error'))

    const event = { type: 'booking.created', payload: { userId: USER_ID, tenantId: TENANT_ID } }
    await messageHandler('yoga:events', JSON.stringify(event))

    expect(mockClient.release).toHaveBeenCalled()
  })
})
