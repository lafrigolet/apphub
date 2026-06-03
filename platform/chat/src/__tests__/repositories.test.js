import { describe, it, expect, vi } from 'vitest'
import * as convRepo from '../repositories/conversations.repository.js'
import * as partRepo from '../repositories/participants.repository.js'
import * as msgRepo from '../repositories/messages.repository.js'
import * as reactionRepo from '../repositories/reactions.repository.js'
import * as attachmentRepo from '../repositories/attachments.repository.js'
import * as blockRepo from '../repositories/blocks.repository.js'
import * as reportRepo from '../repositories/reports.repository.js'
import * as settingsRepo from '../repositories/settings.repository.js'

const client = (rows = []) => ({ query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }) })

describe('conversations.repository', () => {
  it('insert targets platform_chat.conversations and passes the dedupe key', async () => {
    const c = client([{ id: 'c1' }])
    await convRepo.insert(c, { appId: 'a', tenantId: 't', type: 'direct', createdBy: 'u', dedupeKey: 'u:v' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_chat\.conversations/)
    expect(params[8]).toBe('u:v')
  })
  it('findById / findByDedupe return null when no row', async () => {
    expect(await convRepo.findById(client([]), 'x')).toBeNull()
    expect(await convRepo.findByDedupe(client([]), 'k')).toBeNull()
  })
  it('listForUser filters by type/status and joins participants', async () => {
    const c = client([{ id: 'c1', unread_count: 2 }])
    await convRepo.listForUser(c, 'u', { type: 'group', status: 'active', limit: 10 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/conversation_participants/)
    expect(sql).toMatch(/unread_count/)
    expect(params).toEqual(['u', 'group', 'active', 10])
  })
  it('update builds a dynamic SET and skips undefined', async () => {
    const c = client([{ id: 'c1', title: 'T' }])
    await convRepo.update(c, 'c1', { title: 'T', topic: undefined })
    expect(c.query.mock.calls[0][0]).toMatch(/SET title = \$2/)
  })
  it('update with no fields just re-reads', async () => {
    const c = client([{ id: 'c1' }])
    await convRepo.update(c, 'c1', {})
    expect(c.query.mock.calls[0][0]).toMatch(/SELECT/)
  })
  it('bumpLastMessageAt + listSupportQueue', async () => {
    const c = client([])
    await convRepo.bumpLastMessageAt(c, 'c1', 'now')
    expect(c.query.mock.calls[0][0]).toMatch(/SET last_message_at/)
    const c2 = client([])
    await convRepo.listSupportQueue(c2, { status: 'open', limit: 5 })
    expect(c2.query.mock.calls[0][0]).toMatch(/type = 'support'/)
    expect(c2.query.mock.calls[0][1]).toEqual(['open', 5])
  })
})

describe('participants.repository', () => {
  it('insert upserts and re-activates on conflict', async () => {
    const c = client([{ user_id: 'u' }])
    await partRepo.insert(c, { conversationId: 'c1', userId: 'u', appId: 'a', tenantId: 't', role: 'owner' })
    expect(c.query.mock.calls[0][0]).toMatch(/ON CONFLICT \(conversation_id, user_id\)/)
  })
  it('list excludes left by default, includes when asked', async () => {
    const c1 = client([]); await partRepo.list(c1, 'c1')
    expect(c1.query.mock.calls[0][0]).toMatch(/left_at IS NULL/)
    const c2 = client([]); await partRepo.list(c2, 'c1', { includeLeft: true })
    expect(c2.query.mock.calls[0][0]).not.toMatch(/AND left_at IS NULL/)
  })
  it('countActive returns the integer', async () => {
    expect(await partRepo.countActive(client([{ n: 4 }]), 'c1')).toBe(4)
  })
  it('leave + setLastRead + coParticipantUserIds', async () => {
    const c = client([{ user_id: 'u' }]); await partRepo.leave(c, 'c1', 'u', 'now')
    expect(c.query.mock.calls[0][0]).toMatch(/SET left_at/)
    const c2 = client([{ user_id: 'u' }]); await partRepo.setLastRead(c2, 'c1', 'u', 'm1', 'now')
    expect(c2.query.mock.calls[0][1]).toEqual(['c1', 'u', 'm1', 'now'])
    const c3 = client([{ user_id: 'x' }, { user_id: 'y' }])
    expect(await partRepo.coParticipantUserIds(c3, 'u')).toEqual(['x', 'y'])
  })
})

describe('messages.repository', () => {
  it('insert defaults type to text', async () => {
    const c = client([{ id: 'm1' }])
    await msgRepo.insert(c, { appId: 'a', tenantId: 't', conversationId: 'c1', senderUserId: 'u', body: 'hi' })
    expect(c.query.mock.calls[0][1][4]).toBe('text')
  })
  it('list applies before cursor (DESC) and after cursor (ASC)', async () => {
    const cb = client([]); await msgRepo.list(cb, 'c1', { before: 'm9', limit: 10 })
    expect(cb.query.mock.calls[0][0]).toMatch(/created_at < /)
    expect(cb.query.mock.calls[0][0]).toMatch(/ORDER BY m\.created_at DESC/)
    const ca = client([]); await msgRepo.list(ca, 'c1', { after: 'm1', limit: 10 })
    expect(ca.query.mock.calls[0][0]).toMatch(/created_at > /)
    expect(ca.query.mock.calls[0][0]).toMatch(/ORDER BY m\.created_at ASC/)
  })
  it('updateBody + softDelete guard on deleted_at IS NULL', async () => {
    const c = client([{ id: 'm1' }]); await msgRepo.updateBody(c, 'm1', 'x', 'now')
    expect(c.query.mock.calls[0][0]).toMatch(/deleted_at IS NULL/)
    const c2 = client([{ id: 'm1' }]); await msgRepo.softDelete(c2, 'm1', 'now')
    expect(c2.query.mock.calls[0][0]).toMatch(/body = NULL/)
  })
  it('search joins participants + uses tsquery', async () => {
    const c = client([]); await msgRepo.search(c, 'u', 'hello', { limit: 20 })
    expect(c.query.mock.calls[0][0]).toMatch(/plainto_tsquery\('simple', \$2\)/)
    expect(c.query.mock.calls[0][1]).toEqual(['u', 'hello', 20])
  })
  it('unreadSummary filters out zero counts', async () => {
    const c = client([{ conversation_id: 'a', unread_count: 0 }, { conversation_id: 'b', unread_count: 3 }])
    expect(await msgRepo.unreadSummary(c, 'u')).toEqual([{ conversation_id: 'b', unread_count: 3 }])
  })
  it('insertMentions no-ops on empty, batches on values', async () => {
    const c = client([]); await msgRepo.insertMentions(c, { id: 'm1', app_id: 'a', tenant_id: 't' }, [])
    expect(c.query).not.toHaveBeenCalled()
    const c2 = client([]); await msgRepo.insertMentions(c2, { id: 'm1', app_id: 'a', tenant_id: 't' }, ['u1', 'u2'])
    expect(c2.query.mock.calls[0][1]).toEqual(['m1', 'a', 't', 'u1', 'u2'])
  })
})

describe('reactions / attachments / blocks / reports / settings repos', () => {
  it('reactions add/remove/list', async () => {
    const c = client([{ emoji: '👍' }]); await reactionRepo.add(c, { messageId: 'm1', userId: 'u', emoji: '👍', appId: 'a', tenantId: 't' })
    expect(c.query.mock.calls[0][0]).toMatch(/ON CONFLICT \(message_id, user_id, emoji\) DO NOTHING/)
    const c2 = client([]); expect(await reactionRepo.remove(c2, 'm1', 'u', '👍')).toBe(false)
    const c3 = client([{ emoji: '👍', count: 2 }]); await reactionRepo.listForMessage(c3, 'm1')
    expect(c3.query.mock.calls[0][0]).toMatch(/GROUP BY emoji/)
  })
  it('attachments insert defaults display_order', async () => {
    const c = client([{ id: 'a1' }]); await attachmentRepo.insert(c, { appId: 'a', tenantId: 't', messageId: 'm1', objectId: 'o', kind: 'file' })
    expect(c.query.mock.calls[0][1][5]).toBe(0) // displayOrder ?? 0
    const c2 = client([]); expect(await attachmentRepo.remove(c2, 'a1')).toBe(false)
    expect(await attachmentRepo.findById(client([]), 'a1')).toBeNull()
  })
  it('blocks add/remove/list/existsBetween', async () => {
    const c = client([{ blocked_user_id: 'b' }]); await blockRepo.add(c, { appId: 'a', tenantId: 't', userId: 'u', blockedUserId: 'b' })
    expect(c.query.mock.calls[0][0]).toMatch(/ON CONFLICT/)
    const c2 = client([{ x: 1 }]); expect(await blockRepo.existsBetween(c2, 'u', 'v')).toBe(true)
    const c3 = client([]); expect(await blockRepo.existsBetween(c3, 'u', 'v')).toBe(false)
    await blockRepo.remove(client([]), { appId: 'a', tenantId: 't', userId: 'u', blockedUserId: 'b' })
    await blockRepo.listForUser(client([]), 'u')
  })
  it('reports insert/list/updateStatus', async () => {
    const c = client([{ id: 'r1' }]); await reportRepo.insert(c, { appId: 'a', tenantId: 't', targetType: 'message', targetId: 'm1', reporterUserId: 'u' })
    expect(c.query.mock.calls[0][0]).toMatch(/INSERT INTO platform_chat\.reports/)
    const c2 = client([]); await reportRepo.list(c2, { status: 'open', limit: 10 })
    expect(c2.query.mock.calls[0][1]).toEqual(['open', 10])
    const c3 = client([]); await reportRepo.list(c3, {})
    expect(c3.query.mock.calls[0][0]).not.toMatch(/WHERE/)
    const c4 = client([{ id: 'r1', status: 'reviewed' }]); await reportRepo.updateStatus(c4, 'r1', 'reviewed')
    expect(c4.query.mock.calls[0][1]).toEqual(['r1', 'reviewed'])
  })
  it('settings find/upsert', async () => {
    expect(await settingsRepo.find(client([]), 'a', 't')).toBeNull()
    const c = client([{ app_id: 'a' }]); await settingsRepo.upsert(c, 'a', 't', { allowGroups: false })
    expect(c.query.mock.calls[0][0]).toMatch(/ON CONFLICT \(app_id, tenant_id\) DO UPDATE/)
  })
})
