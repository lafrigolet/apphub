import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/redis.js', () => ({
  publishRealtime: vi.fn().mockResolvedValue(),
  publishPlatformEvent: vi.fn().mockResolvedValue(),
}))

import * as realtime from '../services/realtime.service.js'
import { publishRealtime, publishPlatformEvent } from '../lib/redis.js'

const ctx = { appId: 'platform', tenantId: 't1' }

beforeEach(() => vi.clearAllMocks())

describe('realtime.service', () => {
  it('emit publishes an rt frame with recipients to the tenant channel', async () => {
    await realtime.emit(ctx, ['u2', 'u3'], { conversationId: 'c1', type: 'message.created', payload: { message: { id: 'm1' } } })
    expect(publishRealtime).toHaveBeenCalledWith('platform', 't1', expect.objectContaining({
      v: 1, appId: 'platform', tenantId: 't1', conversationId: 'c1', type: 'message.created', recipientUserIds: ['u2', 'u3'],
    }))
  })

  it('emit defaults recipients to an empty array', async () => {
    await realtime.emit(ctx, undefined, { conversationId: 'c1', type: 'typing', payload: {} })
    expect(publishRealtime.mock.calls[0][2].recipientUserIds).toEqual([])
  })

  it('notify publishes a domain event on the platform bus', async () => {
    await realtime.notify('chat.message.created', { messageId: 'm1' })
    expect(publishPlatformEvent).toHaveBeenCalledWith('chat.message.created', { messageId: 'm1' })
  })
})
