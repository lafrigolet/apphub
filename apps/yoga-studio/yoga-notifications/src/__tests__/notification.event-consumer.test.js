import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    REDIS_URL: 'redis://localhost:6379',
    YOGA_TENANT_ID: '00000000-0000-0000-0000-000000000001',
    YOGA_SENDGRID_API_KEY: 'SG.test',
    YOGA_SENDGRID_FROM_EMAIL: 'noreply@yoga.com',
  },
}))

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn() },
  setTenantContext: vi.fn(),
}))

vi.mock('../services/mailer.js', () => ({ sendEmail: vi.fn() }))

vi.mock('ioredis', () => {
  const MockRedis = vi.fn(() => ({
    subscribe: vi.fn((ch, cb) => cb(null)),
    on: vi.fn(),
  }))
  return { default: MockRedis }
})

import { startEventConsumer } from '../services/event-consumer.js'
import { pool, setTenantContext } from '../lib/db.js'
import { sendEmail } from '../services/mailer.js'
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

  const mockClient = {
    query: vi.fn().mockResolvedValue({ rows: [{ email: 'user@yoga.com' }] }),
    release: vi.fn(),
  }
  pool.connect.mockResolvedValue(mockClient)
  setTenantContext.mockResolvedValue()
  sendEmail.mockResolvedValue()

  startEventConsumer()
  return { messageHandler, mockClient }
}

beforeEach(() => vi.clearAllMocks())

describe('event-consumer (yoga-notifications)', () => {
  it('sends email on user.registered event', async () => {
    const { messageHandler } = setupConsumer()

    const event = {
      type: 'user.registered',
      payload: { userId: USER_ID, email: 'user@yoga.com', tenantId: TENANT_ID },
    }
    await messageHandler('yoga:events', JSON.stringify(event))

    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'user@yoga.com',
      subject: 'Welcome to Yoga Studio!',
    }))
  })

  it('sends email on booking.created event', async () => {
    const { messageHandler } = setupConsumer()

    const event = {
      type: 'booking.created',
      payload: { userId: USER_ID, sessionId: 's1', bookingId: 'b1', tenantId: TENANT_ID },
    }
    await messageHandler('yoga:events', JSON.stringify(event))

    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'Booking Confirmed',
    }))
  })

  it('sends email on password.reset.requested event', async () => {
    const { messageHandler } = setupConsumer()

    const event = {
      type: 'password.reset.requested',
      payload: { userId: USER_ID, email: 'user@yoga.com', token: 'tok123', tenantId: TENANT_ID },
    }
    await messageHandler('yoga:events', JSON.stringify(event))

    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'Password Reset Request',
      text: expect.stringContaining('tok123'),
    }))
  })

  it('skips events without a matching template', async () => {
    const { messageHandler } = setupConsumer()

    const event = {
      type: 'unknown.event',
      payload: { userId: USER_ID, tenantId: TENANT_ID },
    }
    await messageHandler('yoga:events', JSON.stringify(event))

    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('skips when userId missing', async () => {
    const { messageHandler } = setupConsumer()
    const event = { type: 'user.registered', payload: { tenantId: TENANT_ID } }
    await messageHandler('yoga:events', JSON.stringify(event))
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('skips when tenantId missing', async () => {
    const { messageHandler } = setupConsumer()
    const event = { type: 'user.registered', payload: { userId: USER_ID } }
    await messageHandler('yoga:events', JSON.stringify(event))
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('skips when user email not found in DB', async () => {
    let messageHandler
    const redisMock = { subscribe: vi.fn(), on: vi.fn((ev, h) => { if (ev === 'message') messageHandler = h }) }
    Redis.mockReturnValue(redisMock)
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
    pool.connect.mockResolvedValue(client)
    setTenantContext.mockResolvedValue()

    startEventConsumer()
    const event = { type: 'user.registered', payload: { userId: USER_ID, tenantId: TENANT_ID } }
    await messageHandler('yoga:events', JSON.stringify(event))

    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('releases DB client even when sendEmail throws', async () => {
    const { messageHandler, mockClient } = setupConsumer()
    sendEmail.mockRejectedValue(new Error('SendGrid down'))

    const event = { type: 'booking.created', payload: { userId: USER_ID, sessionId: 's1', tenantId: TENANT_ID } }
    await messageHandler('yoga:events', JSON.stringify(event))

    expect(mockClient.release).toHaveBeenCalled()
  })
})
