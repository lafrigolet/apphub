import { describe, it, expect, vi } from 'vitest'
import * as pinRepo from '../repositories/pins.repository.js'
import * as inviteRepo from '../repositories/invites.repository.js'
import * as banRepo from '../repositories/bans.repository.js'
import * as csatRepo from '../repositories/csat.repository.js'
import * as macroRepo from '../repositories/macros.repository.js'
import * as convRepo from '../repositories/conversations.repository.js'
import * as msgRepo from '../repositories/messages.repository.js'
import * as partRepo from '../repositories/participants.repository.js'

const client = (rows = []) => ({ query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }) })

describe('pins.repository', () => {
  it('add upserts, remove + list', async () => {
    const c = client([{ message_id: 'm1' }])
    await pinRepo.add(c, { conversationId: 'c1', messageId: 'm1', appId: 'a', tenantId: 't', pinnedBy: 'u' })
    expect(c.query.mock.calls[0][0]).toMatch(/ON CONFLICT \(conversation_id, message_id\) DO NOTHING/)
    expect(await pinRepo.remove(client([]), 'c1', 'm1')).toBe(false)
    const c2 = client([{ message_id: 'm1' }]); await pinRepo.listForConversation(c2, 'c1')
    expect(c2.query.mock.calls[0][0]).toMatch(/JOIN platform_chat\.messages/)
  })
})

describe('invites.repository', () => {
  it('insert/findByCode/list/increment/revoke', async () => {
    const c = client([{ id: 'i1', code: 'abc' }])
    await inviteRepo.insert(c, { appId: 'a', tenantId: 't', conversationId: 'c1', code: 'abc', createdBy: 'u', role: 'member' })
    expect(c.query.mock.calls[0][0]).toMatch(/INSERT INTO platform_chat\.conversation_invites/)
    expect(await inviteRepo.findByCode(client([]), 'x')).toBeNull()
    await inviteRepo.listForConversation(client([]), 'c1')
    const c2 = client([{ id: 'i1', uses: 1 }]); await inviteRepo.incrementUses(c2, 'i1')
    expect(c2.query.mock.calls[0][0]).toMatch(/uses = uses \+ 1/)
    const c3 = client([{ id: 'i1', revoked_at: 'now' }]); await inviteRepo.revoke(c3, 'i1')
    expect(c3.query.mock.calls[0][0]).toMatch(/revoked_at = now\(\)/)
  })
})

describe('bans.repository', () => {
  it('add/remove/list/isBanned', async () => {
    const c = client([{ user_id: 'u' }])
    await banRepo.add(c, { appId: 'a', tenantId: 't', userId: 'u', bannedBy: 's', reason: 'spam' })
    expect(c.query.mock.calls[0][0]).toMatch(/ON CONFLICT \(app_id, tenant_id, user_id\)/)
    expect(await banRepo.remove(client([]), { appId: 'a', tenantId: 't', userId: 'u' })).toBe(false)
    await banRepo.list(client([]))
    expect(await banRepo.isBanned(client([{ x: 1 }]), 'u')).toBe(true)
    expect(await banRepo.isBanned(client([]), 'u')).toBe(false)
  })
})

describe('csat.repository + macros.repository', () => {
  it('csat insert upsert + get', async () => {
    const c = client([{ id: 'cs1' }])
    await csatRepo.insert(c, { appId: 'a', tenantId: 't', conversationId: 'c1', rating: 5, submittedBy: 'u' })
    expect(c.query.mock.calls[0][0]).toMatch(/ON CONFLICT \(conversation_id, submitted_by\)/)
    await csatRepo.getForConversation(client([]), 'c1')
  })
  it('macros insert/list/findById/remove', async () => {
    const c = client([{ id: 'mm1' }])
    await macroRepo.insert(c, { appId: 'a', tenantId: 't', title: 'Hi', body: 'Hello', createdBy: 'u' })
    expect(c.query.mock.calls[0][0]).toMatch(/INSERT INTO platform_chat\.support_macros/)
    await macroRepo.list(client([]))
    expect(await macroRepo.findById(client([]), 'mm1')).toBeNull()
    expect(await macroRepo.remove(client([]), 'mm1')).toBe(false)
  })
})

describe('conversations.repository — new', () => {
  it('listPublic filters public active groups', async () => {
    const c = client([{ id: 'c1' }]); await convRepo.listPublic(c, { limit: 10 })
    expect(c.query.mock.calls[0][0]).toMatch(/is_public/)
    expect(c.query.mock.calls[0][1]).toEqual([10])
  })
  it('metrics aggregates counts', async () => {
    const c = client([{ direct_count: 1 }]); await convRepo.metrics(c, 30)
    expect(c.query.mock.calls[0][0]).toMatch(/direct_count/)
    expect(c.query.mock.calls[0][1]).toEqual(['30'])
  })
  it('exportMessages selects sent messages', async () => {
    const c = client([]); await convRepo.exportMessages(c, 'c1')
    expect(c.query.mock.calls[0][0]).toMatch(/status = 'sent'/)
  })
  it('listSupportQueue accepts queue filter', async () => {
    const c = client([]); await convRepo.listSupportQueue(c, { status: 'open', queue: 'billing', limit: 5 })
    expect(c.query.mock.calls[0][1]).toEqual(['open', 'billing', 5])
  })
})

describe('messages.repository — new', () => {
  it('deliverScheduled flips status + restamps created_at', async () => {
    const c = client([{ id: 'm1', status: 'sent' }]); await msgRepo.deliverScheduled(c, 'm1', 'now')
    expect(c.query.mock.calls[0][0]).toMatch(/SET status = 'sent', created_at = \$2/)
    expect(c.query.mock.calls[0][0]).toMatch(/WHERE id = \$1 AND status = 'scheduled'/)
  })
  it('listThread returns root + replies', async () => {
    const c = client([]); await msgRepo.listThread(c, 'root1', { limit: 50 })
    expect(c.query.mock.calls[0][0]).toMatch(/id = \$1 OR thread_root_id = \$1/)
  })
  it('list excludes scheduled + threaded + expired', async () => {
    const c = client([]); await msgRepo.list(c, 'c1', { limit: 10 })
    const sql = c.query.mock.calls[0][0]
    expect(sql).toMatch(/status = 'sent'/)
    expect(sql).toMatch(/thread_root_id IS NULL/)
    expect(sql).toMatch(/expires_at IS NULL OR m\.expires_at > now\(\)/)
  })
  it('search applies optional filters', async () => {
    const c = client([]); await msgRepo.search(c, 'u', 'hi', { conversationId: 'c1', senderUserId: 's1', type: 'text', limit: 5 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/m\.conversation_id = \$3/)
    expect(params).toEqual(['u', 'hi', 'c1', 's1', 'text', 5])
  })
  it('insert carries thread/scheduled/ephemeral fields', async () => {
    const c = client([{ id: 'm1' }])
    await msgRepo.insert(c, { appId: 'a', tenantId: 't', conversationId: 'c1', senderUserId: 'u', body: 'x', threadRootId: 'r1', status: 'scheduled', scheduledFor: 'later', expiresAt: 'soon' })
    const params = c.query.mock.calls[0][1]
    expect(params[7]).toBe('r1')   // thread_root_id
    expect(params[8]).toBe('scheduled')
    expect(params[9]).toBe('later')
    expect(params[10]).toBe('soon')
  })
})

describe('participants.repository — setDelivered', () => {
  it('updates delivered marker', async () => {
    const c = client([{ user_id: 'u' }]); await partRepo.setDelivered(c, 'c1', 'u', 'm1', 'now')
    expect(c.query.mock.calls[0][0]).toMatch(/last_delivered_message_id = \$3/)
    expect(c.query.mock.calls[0][1]).toEqual(['c1', 'u', 'm1', 'now'])
  })
})
