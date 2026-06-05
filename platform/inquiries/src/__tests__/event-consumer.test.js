// inquiries event-consumer — `inquiry.reply.received` (inbound email bridge)
// appends an 'email_reply' activity to the inquiry timeline.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const tx = vi.hoisted(() => ({ withTenantTransaction: vi.fn() }))
vi.mock('../lib/db.js', () => ({ ...tx, pool: {}, configurePool: vi.fn() }))

const repo = vi.hoisted(() => ({ findById: vi.fn(), insertActivity: vi.fn() }))
vi.mock('../repositories/inquiries.repository.js', () => repo)

import { addEmailReply, startEventConsumer } from '../services/event-consumer.js'

beforeEach(() => {
  vi.clearAllMocks()
  tx.withTenantTransaction.mockImplementation(async (_a, _t, _s, fn) => fn({}))
})

describe('addEmailReply', () => {
  it('appends an email_reply activity with sender + attachment metadata', async () => {
    repo.findById.mockResolvedValue({ id: 'i1', status: 'new' })
    repo.insertActivity.mockResolvedValue({ id: 'act1' })
    const r = await addEmailReply({
      appId: 'aikikan', tenantId: 't1', inquiryId: 'i1',
      from: 'ana@x.com', fromName: 'Ana', text: 'Gracias, ¿precio?',
      attachments: [{ filename: 'doc.pdf', contentType: 'application/pdf', sizeBytes: 100, bucket: 'b', objectKey: 'k' }],
      inboundEmailId: 'e1',
    })
    expect(r).toEqual({ id: 'act1' })
    expect(tx.withTenantTransaction).toHaveBeenCalledWith('aikikan', 't1', null, expect.any(Function))
    expect(repo.insertActivity).toHaveBeenCalledWith(expect.anything(), 'i1', expect.objectContaining({
      type: 'email_reply',
      authorEmail: 'ana@x.com',
      body: 'Gracias, ¿precio?',
      metadata: expect.objectContaining({
        inboundEmailId: 'e1',
        attachments: [expect.objectContaining({ objectKey: 'k' })],
      }),
    }))
  })
  it('null when the inquiry does not exist (token pointing at a purged row)', async () => {
    repo.findById.mockResolvedValue(null)
    expect(await addEmailReply({ appId: 'a', tenantId: 't', inquiryId: 'gone' })).toBe(null)
    expect(repo.insertActivity).not.toHaveBeenCalled()
  })
})

describe('startEventConsumer', () => {
  function mkRedis() {
    const handlers = {}
    const sub = {
      subscribe: vi.fn((_c, cb) => cb?.(null)),
      on: vi.fn((evt, fn) => { handlers[evt] = fn }),
    }
    return { redis: { duplicate: () => sub }, sub, handlers }
  }

  it('handles inquiry.reply.received end-to-end', async () => {
    repo.findById.mockResolvedValue({ id: 'i1' })
    repo.insertActivity.mockResolvedValue({ id: 'act1' })
    const { redis, handlers } = mkRedis()
    startEventConsumer({ redis, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } })
    await handlers.message('platform.events', JSON.stringify({
      type: 'inquiry.reply.received',
      payload: {
        appId: 'aikikan', tenantId: 't1', from: 'ana@x.com',
        text: 'hola', context: { inquiryId: 'i1' }, inboundEmailId: 'e1',
      },
    }))
    expect(repo.insertActivity).toHaveBeenCalled()
  })

  it('ignores events without tenant/inquiry context and unrelated types', async () => {
    const { redis, handlers } = mkRedis()
    startEventConsumer({ redis, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } })
    await handlers.message('platform.events', JSON.stringify({ type: 'inquiry.reply.received', payload: { from: 'x@y' } }))
    await handlers.message('platform.events', JSON.stringify({ type: 'lead.created', payload: {} }))
    await handlers.message('platform.events', 'not-json')
    expect(repo.insertActivity).not.toHaveBeenCalled()
  })

  it('returns null without a duplicable redis', () => {
    expect(startEventConsumer({ redis: null })).toBe(null)
  })
})
