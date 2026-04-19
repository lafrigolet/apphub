import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    YOGA_TENANT_ID: '00000000-0000-0000-0000-000000000001',
    YOGA_CRON_DATABASE_URL: 'postgres://cron@localhost/test',
    DATABASE_URL: 'postgres://test@localhost/test',
    REDIS_URL: 'redis://localhost:6379',
  },
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

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}))

vi.mock('../repositories/booking.repository.js')
vi.mock('node-cron', () => ({ default: { schedule: vi.fn((pattern, fn) => ({ fn })) } }))

import cron from 'node-cron'
import { cronPool } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as bookingRepo from '../repositories/booking.repository.js'
import { startNoShowCron } from '../services/no-show.service.js'

const TENANT_ID = '00000000-0000-0000-0000-000000000001'

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => vi.clearAllMocks())

async function runCronJob() {
  startNoShowCron()
  const [[, handler]] = cron.schedule.mock.calls
  await handler()
}

describe('no-show.service', () => {
  it('marks each finished booking as no-show and publishes event', async () => {
    const client = mockClient()
    cronPool.connect.mockResolvedValue(client)
    const finishedBookings = [
      { id: 'b1', user_id: 'u1', session_id: 's1', tenant_id: TENANT_ID, sub_tenant_id: null },
      { id: 'b2', user_id: 'u2', session_id: 's1', tenant_id: TENANT_ID, sub_tenant_id: null },
    ]
    bookingRepo.findFinishedUnreported.mockResolvedValue(finishedBookings)
    bookingRepo.markNoShow.mockResolvedValue()

    await runCronJob()

    expect(bookingRepo.findFinishedUnreported).toHaveBeenCalledWith(client)
    expect(bookingRepo.markNoShow).toHaveBeenCalledTimes(2)
    expect(publish).toHaveBeenCalledTimes(2)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'no-show.detected',
      payload: expect.objectContaining({ tenantId: TENANT_ID }),
    }))
    expect(client.release).toHaveBeenCalled()
  })

  it('releases client even when an error occurs', async () => {
    const client = mockClient()
    cronPool.connect.mockResolvedValue(client)
    bookingRepo.findFinishedUnreported.mockRejectedValue(new Error('DB error'))

    await runCronJob()

    expect(client.release).toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it('does nothing when no finished bookings found', async () => {
    const client = mockClient()
    cronPool.connect.mockResolvedValue(client)
    bookingRepo.findFinishedUnreported.mockResolvedValue([])

    await runCronJob()

    expect(bookingRepo.markNoShow).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it('uses cronPool (BYPASSRLS) not regular pool', async () => {
    const { pool } = await import('../lib/db.js')
    const client = mockClient()
    cronPool.connect.mockResolvedValue(client)
    bookingRepo.findFinishedUnreported.mockResolvedValue([])

    await runCronJob()

    expect(cronPool.connect).toHaveBeenCalled()
    expect(pool.connect).not.toHaveBeenCalled()
  })

  it('schedules cron every 15 minutes', () => {
    startNoShowCron()
    expect(cron.schedule).toHaveBeenCalledWith('*/15 * * * *', expect.any(Function))
  })
})
