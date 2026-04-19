import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    YOGA_CRON_DATABASE_URL: 'postgres://cron@localhost/test',
    DATABASE_URL: 'postgres://test@localhost/test',
    REDIS_URL: 'redis://localhost:6379',
    YOGA_TENANT_ID: '00000000-0000-0000-0000-000000000001',
  },
}))

vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn() },
  cronPool: { connect: vi.fn() },
  setTenantContext: vi.fn(),
  withTenantTransaction: vi.fn(),
}))

vi.mock('../lib/redis.js', () => ({ redis: {}, publish: vi.fn() }))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}))
vi.mock('../repositories/bonus.repository.js')
vi.mock('node-cron', () => ({ default: { schedule: vi.fn((pat, fn) => ({ fn })) } }))

import cron from 'node-cron'
import { cronPool } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as bonusRepo from '../repositories/bonus.repository.js'
import { startExpiryAlerts } from '../services/expiry-alert.service.js'

const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const USER_ID = '11111111-1111-1111-1111-111111111111'

function mockClient() {
  return { query: vi.fn(), release: vi.fn() }
}

async function runCronJob() {
  startExpiryAlerts()
  const [[, handler]] = cron.schedule.mock.calls
  await handler()
}

beforeEach(() => vi.clearAllMocks())

describe('expiry-alert.service', () => {
  it('publishes bonus.expiring-soon event for each expiring bonus', async () => {
    const client = mockClient()
    cronPool.connect.mockResolvedValue(client)
    const expiringBonuses = [
      { id: 'b1', user_id: USER_ID, expires_at: new Date(), tenant_id: TENANT_ID, sub_tenant_id: null },
      { id: 'b2', user_id: 'u2', expires_at: new Date(), tenant_id: TENANT_ID, sub_tenant_id: null },
    ]
    bonusRepo.findExpiringBonuses.mockResolvedValue(expiringBonuses)

    await runCronJob()

    expect(publish).toHaveBeenCalledTimes(2)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'bonus.expiring-soon',
      payload: expect.objectContaining({ tenantId: TENANT_ID, userId: USER_ID }),
    }))
    expect(client.release).toHaveBeenCalled()
  })

  it('does nothing when no expiring bonuses', async () => {
    const client = mockClient()
    cronPool.connect.mockResolvedValue(client)
    bonusRepo.findExpiringBonuses.mockResolvedValue([])

    await runCronJob()

    expect(publish).not.toHaveBeenCalled()
    expect(client.release).toHaveBeenCalled()
  })

  it('releases client on error', async () => {
    const client = mockClient()
    cronPool.connect.mockResolvedValue(client)
    bonusRepo.findExpiringBonuses.mockRejectedValue(new Error('DB fail'))

    await runCronJob()

    expect(client.release).toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it('uses cronPool (BYPASSRLS) not regular pool', async () => {
    const { pool } = await import('../lib/db.js')
    const client = mockClient()
    cronPool.connect.mockResolvedValue(client)
    bonusRepo.findExpiringBonuses.mockResolvedValue([])

    await runCronJob()

    expect(cronPool.connect).toHaveBeenCalled()
    expect(pool.connect).not.toHaveBeenCalled()
  })

  it('schedules cron at 8am daily', () => {
    startExpiryAlerts()
    expect(cron.schedule).toHaveBeenCalledWith('0 8 * * *', expect.any(Function))
  })
})
