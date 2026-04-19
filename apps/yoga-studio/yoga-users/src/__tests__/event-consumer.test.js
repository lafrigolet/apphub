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

vi.mock('../repositories/profile.repository.js')

vi.mock('ioredis', () => {
  const MockRedis = vi.fn(() => ({
    subscribe: vi.fn((ch, cb) => cb(null)),
    on: vi.fn(),
  }))
  return { default: MockRedis }
})

import { startEventConsumer } from '../services/event-consumer.js'
import { pool, setTenantContext } from '../lib/db.js'
import * as profileRepo from '../repositories/profile.repository.js'
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

  startEventConsumer()
  return { redisMock, messageHandler, mockClient }
}

beforeEach(() => vi.clearAllMocks())

describe('event-consumer (yoga-users)', () => {
  it('creates profile on user.registered event', async () => {
    const { messageHandler, mockClient } = setupConsumer()
    profileRepo.upsertProfile.mockResolvedValue({ id: USER_ID })

    const event = {
      type: 'user.registered',
      payload: { userId: USER_ID, email: 'ana@yoga.com', role: 'alumno', tenantId: TENANT_ID },
    }
    await messageHandler('yoga:events', JSON.stringify(event))

    expect(setTenantContext).toHaveBeenCalledWith(mockClient, TENANT_ID, undefined)
    expect(profileRepo.upsertProfile).toHaveBeenCalledWith(
      mockClient,
      expect.objectContaining({ id: USER_ID, email: 'ana@yoga.com', tenantId: TENANT_ID }),
    )
    expect(mockClient.release).toHaveBeenCalled()
  })

  it('adds class history on booking.attended event', async () => {
    const { messageHandler, mockClient } = setupConsumer()
    profileRepo.addHistory.mockResolvedValue()

    const event = {
      type: 'booking.attended',
      payload: {
        userId: USER_ID, bookingId: 'b1', className: 'Hatha',
        instructorName: 'Maria', attendedAt: new Date().toISOString(),
        tenantId: TENANT_ID,
      },
    }
    await messageHandler('yoga:events', JSON.stringify(event))

    expect(profileRepo.addHistory).toHaveBeenCalledWith(
      mockClient,
      expect.objectContaining({ userId: USER_ID, bookingId: 'b1', className: 'Hatha' }),
    )
  })

  it('skips events without tenantId', async () => {
    const { messageHandler } = setupConsumer()
    const event = { type: 'user.registered', payload: { userId: USER_ID, email: 'x@y.com' } }
    await messageHandler('yoga:events', JSON.stringify(event))
    expect(profileRepo.upsertProfile).not.toHaveBeenCalled()
  })

  it('ignores non-JSON messages without crashing', async () => {
    const { messageHandler } = setupConsumer()
    await messageHandler('yoga:events', 'not json at all')
    expect(profileRepo.upsertProfile).not.toHaveBeenCalled()
  })

  it('releases client even when repo throws', async () => {
    const { messageHandler, mockClient } = setupConsumer()
    profileRepo.upsertProfile.mockRejectedValue(new Error('DB error'))

    const event = {
      type: 'user.registered',
      payload: { userId: USER_ID, email: 'x@y.com', role: 'alumno', tenantId: TENANT_ID },
    }
    await messageHandler('yoga:events', JSON.stringify(event))
    expect(mockClient.release).toHaveBeenCalled()
  })
})
