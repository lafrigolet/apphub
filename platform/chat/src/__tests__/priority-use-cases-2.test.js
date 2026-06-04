import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── unit-level mocks (services under test) ───────────────────────────────────
vi.mock('../lib/env.js', () => ({ env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z' } }))
vi.mock('../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../lib/db.js', () => ({ withTenantTransaction: vi.fn() }))
vi.mock('../repositories/conversations.repository.js')
vi.mock('../repositories/participants.repository.js')
vi.mock('../repositories/messages.repository.js')
vi.mock('../repositories/blocks.repository.js')
vi.mock('../repositories/bans.repository.js')
vi.mock('../repositories/invites.repository.js')
vi.mock('../repositories/reports.repository.js')
vi.mock('../services/realtime.service.js', () => ({ emit: vi.fn().mockResolvedValue(), notify: vi.fn().mockResolvedValue() }))
vi.mock('../services/settings.service.js', () => ({ resolve: vi.fn() }))

import * as convSvc from '../services/conversations.service.js'
import * as moderation from '../services/moderation.service.js'
import { withTenantTransaction } from '../lib/db.js'
import * as convRepo from '../repositories/conversations.repository.js'
import * as partRepo from '../repositories/participants.repository.js'
import * as msgRepo from '../repositories/messages.repository.js'
import * as blockRepo from '../repositories/blocks.repository.js'
import * as banRepo from '../repositories/bans.repository.js'
import * as reportRepo from '../repositories/reports.repository.js'
import * as realtime from '../services/realtime.service.js'
import { resolve as resolveSettings } from '../services/settings.service.js'

const APP = 'platform'
const TENANT = '22222222-2222-2222-2222-222222222222'
const ctx = (o = {}) => ({ userId: 'me', appId: APP, tenantId: TENANT, subTenantId: null, role: 'user', ...o })
const staff = (o = {}) => ctx({ userId: 's', role: 'staff', ...o })
const SETTINGS = { allow_groups: true, max_group_size: 256, support_enabled: true, redaction_enabled: false }

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_a, _t, _s, fn) => fn({}))
  resolveSettings.mockResolvedValue(SETTINGS)
  banRepo.isBanned.mockResolvedValue(false)
  convRepo.insert.mockImplementation(async (_c, conv) => ({ id: 'c1', type: conv.type, ...conv }))
  convRepo.bumpLastMessageAt.mockResolvedValue()
  partRepo.insert.mockImplementation(async (_c, p) => ({ ...p }))
  msgRepo.insert.mockResolvedValue({ id: 'sys1', created_at: 'now' })
})

// ── #7 support auto first-response ───────────────────────────────────────────
describe('support auto first-response', () => {
  it('posts a system ack message when support_auto_reply is configured', async () => {
    resolveSettings.mockResolvedValue({ ...SETTINGS, support_auto_reply: 'We got your request!' })
    await convSvc.create(ctx(), { type: 'support', subject: 'Help' })
    const sysCall = msgRepo.insert.mock.calls.find((c) => c[1].type === 'system')
    expect(sysCall).toBeTruthy()
    expect(sysCall[1]).toMatchObject({ senderUserId: null, body: 'We got your request!', metadata: { event: 'support.auto_reply' } })
    expect(convRepo.bumpLastMessageAt).toHaveBeenCalled()
  })
  it('skips the ack when support_auto_reply is null', async () => {
    await convSvc.create(ctx(), { type: 'support', subject: 'Help' })
    expect(msgRepo.insert.mock.calls.some((c) => c[1].type === 'system')).toBe(false)
  })
  it('does not fire the ack for non-support conversations', async () => {
    resolveSettings.mockResolvedValue({ ...SETTINGS, support_auto_reply: 'hi' })
    await convSvc.create(ctx(), { type: 'group', title: 'G', participantIds: [] })
    expect(msgRepo.insert.mock.calls.some((c) => c[1].metadata?.event === 'support.auto_reply')).toBe(false)
  })
})

// ── #2 GDPR right-to-be-forgotten ────────────────────────────────────────────
describe('GDPR — eraseUserData', () => {
  it('requires staff', async () => {
    await expect(moderation.eraseUserData(ctx(), 'victim')).rejects.toMatchObject({ statusCode: 403 })
  })
  it('anonymizes messages, purges blocks, leaves conversations, emits event', async () => {
    msgRepo.anonymizeUser.mockResolvedValue(4)
    blockRepo.purgeUser.mockResolvedValue()
    partRepo.leaveAllForUser.mockResolvedValue(['c1', 'c2'])
    const out = await moderation.eraseUserData(staff(), 'victim')
    expect(msgRepo.anonymizeUser).toHaveBeenCalledWith({}, 'victim')
    expect(blockRepo.purgeUser).toHaveBeenCalledWith({}, 'victim')
    expect(partRepo.leaveAllForUser.mock.calls[0][1]).toBe('victim')
    expect(out).toMatchObject({ userId: 'victim', messagesAnonymized: 4, conversationsLeft: 2 })
    expect(realtime.notify).toHaveBeenCalledWith('chat.user.erased', expect.objectContaining({ userId: 'victim', erasedBy: 's' }))
  })
})

// ── §18 report history per user ──────────────────────────────────────────────
describe('report history per user', () => {
  it('listUserReports requires staff', async () => {
    await expect(moderation.listUserReports(ctx(), 'target', {})).rejects.toMatchObject({ statusCode: 403 })
  })
  it('listUserReports delegates to the repo', async () => {
    reportRepo.listForTargetUser.mockResolvedValue({ total: 3, open: 1, reports: [] })
    const out = await moderation.listUserReports(staff(), 'target', { limit: 50 })
    expect(out.total).toBe(3)
    expect(reportRepo.listForTargetUser).toHaveBeenCalledWith({}, 'target', { limit: 50 })
  })
  it('report() resolves the reported message sender into target_user_id', async () => {
    msgRepo.findById.mockResolvedValue({ id: 'm1', sender_user_id: 'author' })
    reportRepo.insert.mockResolvedValue({ id: 'r1', target_type: 'message', target_id: 'm1' })
    await moderation.report(ctx(), { targetType: 'message', targetId: 'm1', reason: 'spam' })
    expect(reportRepo.insert.mock.calls[0][1]).toMatchObject({ targetUserId: 'author' })
  })
  it('report() leaves target_user_id null for a conversation report', async () => {
    reportRepo.insert.mockResolvedValue({ id: 'r1', target_type: 'conversation', target_id: 'c1' })
    await moderation.report(ctx(), { targetType: 'conversation', targetId: 'c1' })
    expect(reportRepo.insert.mock.calls[0][1]).toMatchObject({ targetUserId: null })
    expect(msgRepo.findById).not.toHaveBeenCalled()
  })
})

// ── repository-level checks (real SQL strings) ───────────────────────────────
describe('repositories — erase + report history SQL', () => {
  const client = (rows = []) => ({ query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }) })

  it('messages.anonymizeUser nulls the author + wipes body, drops reactions/mentions', async () => {
    const { anonymizeUser } = await vi.importActual('../repositories/messages.repository.js')
    const c = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 2 }) }
    const n = await anonymizeUser(c, 'u')
    expect(n).toBe(2)
    expect(c.query.mock.calls[0][0]).toMatch(/SET sender_user_id = NULL, body = NULL/)
    expect(c.query.mock.calls[1][0]).toMatch(/DELETE FROM platform_chat\.message_reactions WHERE user_id/)
    expect(c.query.mock.calls[2][0]).toMatch(/DELETE FROM platform_chat\.message_mentions WHERE mentioned_user_id/)
  })

  it('blocks.purgeUser deletes both directions', async () => {
    const { purgeUser } = await vi.importActual('../repositories/blocks.repository.js')
    const c = client()
    await purgeUser(c, 'u')
    expect(c.query.mock.calls[0][0]).toMatch(/user_id = \$1 OR blocked_user_id = \$1/)
  })

  it('participants.leaveAllForUser stamps left_at and returns conversation ids', async () => {
    const { leaveAllForUser } = await vi.importActual('../repositories/participants.repository.js')
    const c = client([{ conversation_id: 'c1' }, { conversation_id: 'c2' }])
    const ids = await leaveAllForUser(c, 'u', 'now')
    expect(ids).toEqual(['c1', 'c2'])
    expect(c.query.mock.calls[0][0]).toMatch(/SET left_at = \$2[\s\S]*WHERE user_id = \$1 AND left_at IS NULL/)
  })

  it('reports.listForTargetUser returns rows + counts', async () => {
    const { listForTargetUser } = await vi.importActual('../repositories/reports.repository.js')
    const c = { query: vi.fn() }
    c.query.mockResolvedValueOnce({ rows: [{ id: 'r1' }] })
    c.query.mockResolvedValueOnce({ rows: [{ total: 5, open: 2 }] })
    const out = await listForTargetUser(c, 'target', { limit: 10 })
    expect(out).toMatchObject({ total: 5, open: 2, reports: [{ id: 'r1' }] })
    expect(c.query.mock.calls[0][0]).toMatch(/target_user_id = \$1/)
  })

  it('reports.insert persists target_user_id', async () => {
    const { insert } = await vi.importActual('../repositories/reports.repository.js')
    const c = client([{ id: 'r1' }])
    await insert(c, { appId: APP, tenantId: TENANT, targetType: 'message', targetId: 'm1', targetUserId: 'author', reporterUserId: 'me' })
    expect(c.query.mock.calls[0][0]).toMatch(/target_user_id/)
    expect(c.query.mock.calls[0][1]).toContain('author')
  })

  it('settings.upsert wires support_auto_reply with empty-string-clears semantics', async () => {
    const { upsert } = await vi.importActual('../repositories/settings.repository.js')
    const c = client([{ app_id: APP }])
    await upsert(c, APP, TENANT, { supportAutoReply: 'Thanks!' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/support_auto_reply/)
    expect(sql).toMatch(/WHEN \$17 = '' THEN NULL/)
    expect(params[16]).toBe('Thanks!')
  })
})
