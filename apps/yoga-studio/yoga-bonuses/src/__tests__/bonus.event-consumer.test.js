import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { REDIS_URL: 'redis://localhost:6379', YOGA_TENANT_ID: '00000000-0000-0000-0000-000000000001' },
}))

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn() },
  cronPool: { connect: vi.fn() },
  setTenantContext: vi.fn(),
  withTenantTransaction: vi.fn(),
}))

vi.mock('../lib/redis.js', () => ({
  redis: {}, publish: vi.fn(),
}))

vi.mock('../repositories/bonus.repository.js')

vi.mock('ioredis', () => {
  const MockRedis = vi.fn(() => ({
    subscribe: vi.fn((ch, cb) => cb(null)),
    on: vi.fn(),
  }))
  return { default: MockRedis }
})

import { startEventConsumer } from '../services/event-consumer.js'
import { withTenantTransaction } from '../lib/db.js'
import * as bonusRepo from '../repositories/bonus.repository.js'
import Redis from 'ioredis'

const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const USER_ID = '11111111-1111-1111-1111-111111111111'
const BONUS_TYPE_ID = '77777777-7777-7777-7777-777777777777'

function setupConsumer() {
  let messageHandler
  const redisMock = {
    subscribe: vi.fn((ch, cb) => cb(null)),
    on: vi.fn((event, handler) => {
      if (event === 'message') messageHandler = handler
    }),
  }
  Redis.mockReturnValue(redisMock)
  withTenantTransaction.mockImplementation(async (tid, stid, fn) => fn({}))

  startEventConsumer()
  return { redisMock, messageHandler }
}

beforeEach(() => vi.clearAllMocks())

describe('event-consumer (yoga-bonuses)', () => {
  it('activates bonus on payment.completed event', async () => {
    const { messageHandler } = setupConsumer()
    bonusRepo.activateBonusByPayment.mockResolvedValue({ id: 'bonus-1', user_id: USER_ID })

    const event = {
      type: 'payment.completed',
      payload: { userId: USER_ID, bonusTypeId: BONUS_TYPE_ID, tenantId: TENANT_ID },
    }
    await messageHandler('yoga:events', JSON.stringify(event))

    expect(bonusRepo.activateBonusByPayment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: USER_ID, bonusTypeId: BONUS_TYPE_ID, tenantId: TENANT_ID }),
    )
  })

  it('returns credit on booking.cancelled event', async () => {
    const { messageHandler } = setupConsumer()
    bonusRepo.returnCredit.mockResolvedValue()

    const event = {
      type: 'booking.cancelled',
      payload: { userId: USER_ID, tenantId: TENANT_ID },
    }
    await messageHandler('yoga:events', JSON.stringify(event))

    expect(bonusRepo.returnCredit).toHaveBeenCalledWith(
      expect.anything(), USER_ID, TENANT_ID,
    )
  })

  it('logs no-show without refund', async () => {
    const { messageHandler } = setupConsumer()
    const { logger } = await import('../lib/logger.js')

    const event = {
      type: 'no-show.detected',
      payload: { userId: USER_ID, bookingId: 'b1', tenantId: TENANT_ID },
    }
    await messageHandler('yoga:events', JSON.stringify(event))

    expect(bonusRepo.returnCredit).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalled()
  })

  it('skips events without tenantId', async () => {
    const { messageHandler } = setupConsumer()
    const event = { type: 'payment.completed', payload: { userId: USER_ID } }
    await messageHandler('yoga:events', JSON.stringify(event))
    expect(bonusRepo.activateBonusByPayment).not.toHaveBeenCalled()
  })

  it('handles JSON parse errors gracefully', async () => {
    const { messageHandler } = setupConsumer()
    await messageHandler('yoga:events', 'bad json')
    expect(bonusRepo.activateBonusByPayment).not.toHaveBeenCalled()
  })
})
