// Alertas internas de leads (use-cases §16). El event-consumer reacciona a:
//   lead.assigned        → push al nuevo owner (assignedTo)
//   lead.followup.due    → push al owner; sin owner → email a STAFF_OPS_EMAIL
//   lead.sla.uncontacted → email a STAFF_OPS_EMAIL (+ push al owner si existe)
//   lead.stale           → email a STAFF_OPS_EMAIL (+ push al owner si existe)
// El owner se direcciona por push (push_devices va por userId; leads no guarda
// emails de staff). Patrón idéntico a marketplace-appointments-events.test.js.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', REDIS_URL: 'redis://localhost:6379' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../services/rate-limit.service.js', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}))
vi.mock('../services/preferences.service.js', () => ({
  isMuted: vi.fn().mockResolvedValue(false),
}))
vi.mock('../services/idempotency.service.js', () => ({
  claimEvent: vi.fn().mockResolvedValue(true),
}))
vi.mock('../services/digest.service.js', () => ({
  shouldDigest: vi.fn().mockResolvedValue(false),
  enqueueDigest: vi.fn(),
  flushAll: vi.fn(),
}))

const { email, sms, push } = vi.hoisted(() => {
  const make = () => vi.fn()
  return {
    email: { sendLeadSlaInternalEmail: make(), sendLeadAcknowledgementEmail: make() },
    sms: {},
    push: { sendPushToUser: make() },
  }
})
vi.mock('../services/email.service.js', () => email)
vi.mock('../services/sms.service.js', () => sms)
vi.mock('../services/push.service.js', () => push)

let messageHandler
vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
    subscribe:  vi.fn((_channel, cb) => cb(null)),
    psubscribe: vi.fn((_pattern, cb) => cb(null)),
    on: vi.fn((evt, h) => { if (evt === 'message') messageHandler = h }),
  })),
}))

import { startEventConsumer } from '../services/event-consumer.js'

beforeEach(() => {
  vi.clearAllMocks()
  messageHandler = undefined
  process.env.STAFF_OPS_EMAIL = 'ops@example.com'
  startEventConsumer()
})
afterEach(() => { delete process.env.STAFF_OPS_EMAIL })

const emit = (event) => messageHandler('platform.events', JSON.stringify(event))

describe('lead.assigned', () => {
  it('push al nuevo owner', async () => {
    await emit({ type: 'lead.assigned', payload: { appId: 'aikikan', leadId: 'l1', assignedTo: 'u1' } })
    expect(push.sendPushToUser).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'aikikan', userId: 'u1' }),
      'u1',
      expect.objectContaining({ data: expect.objectContaining({ type: 'lead.assigned', leadId: 'l1' }) }),
    )
  })

  it('sin assignedTo → no push', async () => {
    await emit({ type: 'lead.assigned', payload: { appId: 'aikikan', leadId: 'l1', assignedTo: null } })
    expect(push.sendPushToUser).not.toHaveBeenCalled()
  })
})

describe('lead.followup.due', () => {
  it('con owner → push al owner, sin email', async () => {
    await emit({ type: 'lead.followup.due', payload: { appId: 'aikikan', leadId: 'l1', assignedTo: 'u1' } })
    expect(push.sendPushToUser).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }), 'u1', expect.any(Object))
    expect(email.sendLeadSlaInternalEmail).not.toHaveBeenCalled()
  })

  it('sin owner → email a ops con kind followup', async () => {
    await emit({ type: 'lead.followup.due', payload: { appId: 'aikikan', leadId: 'l1', assignedTo: null } })
    expect(push.sendPushToUser).not.toHaveBeenCalled()
    expect(email.sendLeadSlaInternalEmail).toHaveBeenCalledWith('ops@example.com', expect.objectContaining({ kind: 'followup', leadId: 'l1' }))
  })
})

describe('lead.sla.uncontacted / lead.stale', () => {
  it('uncontacted → email a ops (kind uncontacted) + push si owner', async () => {
    await emit({ type: 'lead.sla.uncontacted', payload: { appId: 'aikikan', leadId: 'l1', assignedTo: 'u1', createdAt: 'c', slaHours: 24 } })
    expect(email.sendLeadSlaInternalEmail).toHaveBeenCalledWith('ops@example.com', expect.objectContaining({ kind: 'uncontacted', leadId: 'l1', slaHours: 24 }))
    expect(push.sendPushToUser).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }), 'u1', expect.any(Object))
  })

  it('stale sin owner → solo email a ops (kind stale)', async () => {
    await emit({ type: 'lead.stale', payload: { appId: 'aikikan', leadId: 'l2', assignedTo: null, staleDays: 7 } })
    expect(email.sendLeadSlaInternalEmail).toHaveBeenCalledWith('ops@example.com', expect.objectContaining({ kind: 'stale', leadId: 'l2', staleDays: 7 }))
    expect(push.sendPushToUser).not.toHaveBeenCalled()
  })

  it('sin STAFF_OPS_EMAIL → no intenta email (solo push si owner)', async () => {
    delete process.env.STAFF_OPS_EMAIL
    await emit({ type: 'lead.stale', payload: { appId: 'aikikan', leadId: 'l3', assignedTo: 'u9', staleDays: 7 } })
    expect(email.sendLeadSlaInternalEmail).not.toHaveBeenCalled()
    expect(push.sendPushToUser).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u9' }), 'u9', expect.any(Object))
  })
})
