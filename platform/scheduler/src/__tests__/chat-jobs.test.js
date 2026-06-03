import { describe, it, expect, vi } from 'vitest'
import * as scheduledSend from '../jobs/chat-scheduled-send.job.js'
import * as ephemeralPurge from '../jobs/chat-ephemeral-purge.job.js'
import * as retentionPurge from '../jobs/chat-retention-purge.job.js'
import * as supportSla from '../jobs/chat-support-sla.job.js'

const mkLogger = () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() })

describe('chat-scheduled-send', () => {
  it('stamps dispatched_at and publishes chat.scheduled.due per row', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [
      { id: 'm1', app_id: 'a', tenant_id: 't', conversation_id: 'c1' },
    ] }) }
    const publish = vi.fn().mockResolvedValue()
    const r = await scheduledSend.run({ db, publish, logger: mkLogger() })
    expect(db.query.mock.calls[0][0]).toMatch(/SET dispatched_at = now\(\)/)
    expect(db.query.mock.calls[0][0]).toMatch(/status = 'scheduled'/)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'chat.scheduled.due' }))
    expect(r.rowsAffected).toBe(1)
  })
})

describe('chat-ephemeral-purge', () => {
  it('soft-deletes expired ephemeral messages', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rowCount: 2 }) }
    const r = await ephemeralPurge.run({ db, logger: mkLogger() })
    expect(db.query.mock.calls[0][0]).toMatch(/SET deleted_at = now\(\), body = NULL/)
    expect(db.query.mock.calls[0][0]).toMatch(/expires_at <= now\(\)/)
    expect(r.rowsAffected).toBe(2)
  })
})

describe('chat-retention-purge', () => {
  it('deletes per-tenant retention-expired messages', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rowCount: 5 }) }
    const r = await retentionPurge.run({ db, logger: mkLogger() })
    expect(db.query.mock.calls[0][0]).toMatch(/DELETE FROM platform_chat\.messages/)
    expect(db.query.mock.calls[0][0]).toMatch(/retention_days/)
    expect(r.rowsAffected).toBe(5)
  })
})

describe('chat-support-sla', () => {
  it('flags breaches and publishes chat.support.sla_breached', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [
      { id: 'c1', app_id: 'a', tenant_id: 't', assigned_agent_user_id: 'ag1', priority: 'high', created_at: 'x' },
    ] }) }
    const publish = vi.fn().mockResolvedValue()
    const r = await supportSla.run({ db, publish, logger: mkLogger() })
    expect(db.query.mock.calls[0][0]).toMatch(/sla_breached_at IS NULL/)
    expect(db.query.mock.calls[0][1]).toEqual(['4'])
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'chat.support.sla_breached',
      payload: expect.objectContaining({ conversationId: 'c1', assignedAgentUserId: 'ag1' }),
    }))
    expect(r.rowsAffected).toBe(1)
  })
  it('meta declares the cron schedule', () => {
    expect(supportSla.meta.cron).toBe('*/15 * * * *')
    expect(scheduledSend.meta.cron).toBe('* * * * *')
  })
})
