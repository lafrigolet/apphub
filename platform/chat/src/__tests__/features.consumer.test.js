import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({ env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z' } }))
vi.mock('../services/messages.service.js', () => ({ deliverScheduledFor: vi.fn().mockResolvedValue({ id: 'm1' }) }))

import { startEventConsumer } from '../services/event-consumer.js'
import * as messages from '../services/messages.service.js'

function fakeRedis() {
  const handlers = {}
  const sub = {
    subscribe: vi.fn((_ch, cb) => cb?.(null)),
    on: vi.fn((ev, cb) => { handlers[ev] = cb }),
    quit: vi.fn().mockResolvedValue(),
    emit: (ev, ...a) => handlers[ev]?.(...a),
  }
  return { duplicate: () => sub, _sub: sub }
}

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

beforeEach(() => vi.clearAllMocks())

describe('startEventConsumer', () => {
  it('returns null without a redis', () => {
    expect(startEventConsumer({ redis: null, logger })).toBeNull()
  })

  it('subscribes and delivers due scheduled messages', async () => {
    const redis = fakeRedis()
    const sub = startEventConsumer({ redis, logger })
    expect(sub.subscribe).toHaveBeenCalledWith('platform.events', expect.any(Function))
    await sub.emit('message', 'platform.events', JSON.stringify({
      type: 'chat.scheduled.due', payload: { appId: 'platform', tenantId: 't1', messageId: 'm1' },
    }))
    expect(messages.deliverScheduledFor).toHaveBeenCalledWith({ appId: 'platform', tenantId: 't1', subTenantId: undefined, messageId: 'm1' })
  })

  it('ignores other event types and malformed json', async () => {
    const redis = fakeRedis()
    const sub = startEventConsumer({ redis, logger })
    await sub.emit('message', 'platform.events', 'not-json')
    await sub.emit('message', 'platform.events', JSON.stringify({ type: 'other.event', payload: {} }))
    expect(messages.deliverScheduledFor).not.toHaveBeenCalled()
  })
})
