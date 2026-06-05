// leads event-consumer — `lead.email.received` (inbound email capture):
// the sender becomes a lead with source 'email-inbound'.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const create = vi.hoisted(() => vi.fn())
vi.mock('../services/leads.service.js', () => ({ create }))

import { startEventConsumer } from '../services/event-consumer.js'

function mkRedis() {
  const handlers = {}
  const sub = {
    subscribe: vi.fn((_c, cb) => cb?.(null)),
    on: vi.fn((evt, fn) => { handlers[evt] = fn }),
  }
  return { redis: { duplicate: () => sub }, handlers }
}

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

beforeEach(() => vi.clearAllMocks())

describe('lead.email.received', () => {
  it('creates a lead from the sender with subject+text as message', async () => {
    const { redis, handlers } = mkRedis()
    startEventConsumer({ redis, logger })
    await handlers.message('platform.events', JSON.stringify({
      type: 'lead.email.received',
      payload: {
        from: 'ana@x.com', fromName: 'Ana García', subject: 'Quiero info',
        text: '¿Tenéis demo?', appId: 'aulavera', inboundEmailId: 'e1',
      },
    }))
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      contactName: 'Ana García',
      email: 'ana@x.com',
      message: 'Quiero info\n\n¿Tenéis demo?',
      source: 'email-inbound',
      appId: 'aulavera',
      customFields: { inboundEmailId: 'e1' },
    }))
  })
  it('falls back to the address local-part when no display name', async () => {
    const { redis, handlers } = mkRedis()
    startEventConsumer({ redis, logger })
    await handlers.message('platform.events', JSON.stringify({
      type: 'lead.email.received', payload: { from: 'ana@x.com', text: 'hola' },
    }))
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ contactName: 'ana' }))
  })
  it('ignores events without from, unrelated types and bad JSON', async () => {
    const { redis, handlers } = mkRedis()
    startEventConsumer({ redis, logger })
    await handlers.message('platform.events', JSON.stringify({ type: 'lead.email.received', payload: {} }))
    await handlers.message('platform.events', JSON.stringify({ type: 'inquiry.created', payload: {} }))
    await handlers.message('platform.events', '{bad')
    expect(create).not.toHaveBeenCalled()
  })
  it('a create() failure is swallowed (consumer must not crash)', async () => {
    create.mockRejectedValue(new Error('db down'))
    const { redis, handlers } = mkRedis()
    startEventConsumer({ redis, logger })
    await handlers.message('platform.events', JSON.stringify({
      type: 'lead.email.received', payload: { from: 'ana@x.com' },
    }))
    expect(logger.warn).toHaveBeenCalled()
  })
})
