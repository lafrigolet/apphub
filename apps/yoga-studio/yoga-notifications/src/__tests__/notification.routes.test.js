import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://test@localhost/test',
    REDIS_URL: 'redis://localhost:6379',
    YOGA_TENANT_ID: '00000000-0000-0000-0000-000000000001',
    YOGA_SENDGRID_API_KEY: undefined,
    YOGA_SENDGRID_FROM_EMAIL: 'noreply@yoga.com',
    LOG_LEVEL: 'silent',
    YOGA_NOTIFICATIONS_PORT: 3016,
  },
}))

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn() },
  setTenantContext: vi.fn(),
  withTenantTransaction: vi.fn(),
}))

vi.mock('../lib/redis.js', () => ({ redis: {}, publish: vi.fn() }))
vi.mock('../services/event-consumer.js', () => ({ startEventConsumer: vi.fn() }))
vi.mock('../services/mailer.js', () => ({ sendEmail: vi.fn() }))

import { createApp } from '../app.js'
import { pool } from '../lib/db.js'
import { sendEmail } from '../services/mailer.js'

const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const USER_ID = '11111111-1111-1111-1111-111111111111'

function makeToken(overrides = {}) {
  const payload = {
    sub: USER_ID, role: 'admin', email: 'admin@yoga.com',
    tenant_id: TENANT_ID, exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  }
  return `Bearer x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.y`
}

function mockClient(emailRows = []) {
  return {
    query: vi.fn().mockResolvedValue({ rows: emailRows }),
    release: vi.fn(),
  }
}

let app
beforeEach(async () => {
  app = createApp()
  await app.ready()
})
afterEach(async () => {
  await app.close()
  vi.clearAllMocks()
})

describe('POST /v1/admin/notifications/broadcast', () => {
  it('queues emails for all users and returns count', async () => {
    const client = mockClient([{ email: 'a@yoga.com' }, { email: 'b@yoga.com' }])
    pool.connect.mockResolvedValue(client)
    sendEmail.mockResolvedValue()

    const res = await app.inject({
      method: 'POST', url: '/v1/admin/notifications/broadcast',
      headers: { authorization: makeToken({ role: 'admin' }) },
      payload: { subject: 'Big announcement', text: 'Hello everyone!', segment: 'all' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.queued).toBe(2)
    expect(client.release).toHaveBeenCalled()
  })

  it('uses active_bonus segment query when specified', async () => {
    const client = mockClient([{ email: 'premium@yoga.com' }])
    pool.connect.mockResolvedValue(client)

    const res = await app.inject({
      method: 'POST', url: '/v1/admin/notifications/broadcast',
      headers: { authorization: makeToken({ role: 'admin' }) },
      payload: { subject: 'Promo', text: 'Use your bonus!', segment: 'active_bonus' },
    })

    expect(res.statusCode).toBe(200)
    const [sql] = client.query.mock.calls[0]
    expect(sql).toContain('yoga_bonuses.bonuses')
  })

  it('returns 403 for non-admin', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/admin/notifications/broadcast',
      headers: { authorization: makeToken({ role: 'instructor' }) },
      payload: { subject: 'X', text: 'Y' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('returns 422 on missing subject', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/admin/notifications/broadcast',
      headers: { authorization: makeToken({ role: 'admin' }) },
      payload: { text: 'No subject' },
    })
    expect(res.statusCode).toBe(422)
  })

  it('returns 422 on invalid segment value', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/admin/notifications/broadcast',
      headers: { authorization: makeToken({ role: 'admin' }) },
      payload: { subject: 'S', text: 'T', segment: 'vip_only' },
    })
    expect(res.statusCode).toBe(422)
  })

  it('returns 0 queued when no emails in DB', async () => {
    const client = mockClient([])
    pool.connect.mockResolvedValue(client)

    const res = await app.inject({
      method: 'POST', url: '/v1/admin/notifications/broadcast',
      headers: { authorization: makeToken({ role: 'admin' }) },
      payload: { subject: 'Empty', text: 'Nobody here' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().data.queued).toBe(0)
  })
})
