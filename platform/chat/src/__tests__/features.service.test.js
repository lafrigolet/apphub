import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({ env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', PLATFORM_CORE_BASE_URL: 'http://localhost:3000' } }))
vi.mock('../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../lib/db.js', () => ({ withTenantTransaction: vi.fn() }))
vi.mock('../lib/ratelimit.js', () => ({ enforceRate: vi.fn().mockResolvedValue() }))
vi.mock('../repositories/conversations.repository.js')
vi.mock('../repositories/participants.repository.js')
vi.mock('../repositories/messages.repository.js')
vi.mock('../repositories/blocks.repository.js')
vi.mock('../repositories/bans.repository.js')
vi.mock('../repositories/invites.repository.js')
vi.mock('../repositories/pins.repository.js')
vi.mock('../repositories/reactions.repository.js')
vi.mock('../repositories/attachments.repository.js')
vi.mock('../repositories/csat.repository.js')
vi.mock('../repositories/macros.repository.js')
vi.mock('../services/realtime.service.js', () => ({ emit: vi.fn().mockResolvedValue(), notify: vi.fn().mockResolvedValue() }))
vi.mock('../services/mentions.service.js', () => ({ resolve: vi.fn().mockResolvedValue([]) }))
vi.mock('../services/settings.service.js', () => ({ resolve: vi.fn() }))

import * as conv from '../services/conversations.service.js'
import * as msg from '../services/messages.service.js'
import * as support from '../services/support.service.js'
import * as moderation from '../services/moderation.service.js'
import * as admin from '../services/admin.service.js'
import { withTenantTransaction } from '../lib/db.js'
import * as convRepo from '../repositories/conversations.repository.js'
import * as partRepo from '../repositories/participants.repository.js'
import * as msgRepo from '../repositories/messages.repository.js'
import * as banRepo from '../repositories/bans.repository.js'
import * as inviteRepo from '../repositories/invites.repository.js'
import * as pinRepo from '../repositories/pins.repository.js'
import * as csatRepo from '../repositories/csat.repository.js'
import * as macroRepo from '../repositories/macros.repository.js'
import * as realtime from '../services/realtime.service.js'
import { resolve as resolveSettings } from '../services/settings.service.js'

const ctx = (o = {}) => ({ userId: 'me', appId: 'platform', tenantId: 't1', subTenantId: null, role: 'user', ...o })
const staff = (o = {}) => ctx({ role: 'staff', userId: 's1', ...o })
const PARTS = [{ user_id: 'me', left_at: null, role: 'member' }, { user_id: 'other', left_at: null, role: 'member' }]

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_a, _t, _s, fn) => fn({}))
  resolveSettings.mockResolvedValue({ allow_groups: true, max_group_size: 256, support_enabled: true, redaction_enabled: false, dm_requests: false })
  banRepo.isBanned.mockResolvedValue(false)
  partRepo.find.mockResolvedValue({ user_id: 'me', role: 'member', left_at: null })
  partRepo.list.mockResolvedValue(PARTS)
})

// ── conversations: DM requests ───────────────────────────────────────────────
describe('DM requests', () => {
  it('acceptRequest: recipient flips is_request off', async () => {
    convRepo.findById.mockResolvedValue({ id: 'c1', is_request: true, requested_by: 'other' })
    convRepo.update.mockResolvedValue({ id: 'c1', is_request: false })
    const out = await conv.acceptRequest(ctx(), 'c1')
    expect(out.is_request).toBe(false)
  })
  it('acceptRequest: requester cannot accept own request', async () => {
    convRepo.findById.mockResolvedValue({ id: 'c1', is_request: true, requested_by: 'me' })
    await expect(conv.acceptRequest(ctx(), 'c1')).rejects.toMatchObject({ statusCode: 409 })
  })
  it('acceptRequest: no-op when not a request', async () => {
    convRepo.findById.mockResolvedValue({ id: 'c1', is_request: false })
    const out = await conv.acceptRequest(ctx(), 'c1')
    expect(out.id).toBe('c1')
  })
  it('declineRequest archives + leaves', async () => {
    convRepo.findById.mockResolvedValue({ id: 'c1', is_request: true })
    await conv.declineRequest(ctx(), 'c1')
    expect(partRepo.leave).toHaveBeenCalled()
    expect(convRepo.update).toHaveBeenCalledWith({}, 'c1', { status: 'archived' })
  })
  it('declineRequest rejects non-request', async () => {
    convRepo.findById.mockResolvedValue({ id: 'c1', is_request: false })
    await expect(conv.declineRequest(ctx(), 'c1')).rejects.toMatchObject({ statusCode: 409 })
  })
})

// ── invites ──────────────────────────────────────────────────────────────────
describe('invites', () => {
  beforeEach(() => {
    convRepo.findById.mockResolvedValue({ id: 'c1', type: 'group' })
    partRepo.find.mockResolvedValue({ role: 'owner', left_at: null })
  })
  it('createInvite by manager mints a code', async () => {
    inviteRepo.insert.mockResolvedValue({ id: 'i1', code: 'abc123' })
    const out = await conv.createInvite(ctx(), 'c1', { role: 'member' })
    expect(out.code).toBe('abc123')
    expect(inviteRepo.insert.mock.calls[0][1].code).toMatch(/^[0-9a-f]{12}$/)
  })
  it('createInvite rejected on direct', async () => {
    convRepo.findById.mockResolvedValue({ id: 'c1', type: 'direct' })
    await expect(conv.createInvite(ctx(), 'c1', {})).rejects.toMatchObject({ statusCode: 409 })
  })
  it('createInvite requires manager', async () => {
    partRepo.find.mockResolvedValue({ role: 'member', left_at: null })
    await expect(conv.createInvite(ctx(), 'c1', {})).rejects.toMatchObject({ statusCode: 403 })
  })
  it('listInvites + revokeInvite (manager)', async () => {
    inviteRepo.listForConversation.mockResolvedValue([{ id: 'i1' }])
    expect(await conv.listInvites(ctx(), 'c1')).toHaveLength(1)
    inviteRepo.revoke.mockResolvedValue({ id: 'i1', revoked_at: 'now' })
    expect((await conv.revokeInvite(ctx(), 'c1', 'i1')).revoked_at).toBe('now')
  })
  it('joinByCode validates and adds participant', async () => {
    inviteRepo.findByCode.mockResolvedValue({ id: 'i1', conversation_id: 'c1', role: 'member', revoked_at: null, expires_at: null, max_uses: null, uses: 0 })
    convRepo.findById.mockResolvedValue({ id: 'c1', type: 'group' })
    const out = await conv.joinByCode(ctx(), 'abc')
    expect(partRepo.insert).toHaveBeenCalled()
    expect(inviteRepo.incrementUses).toHaveBeenCalled()
    expect(out.id).toBe('c1')
  })
  it('joinByCode rejects revoked / expired / exhausted', async () => {
    inviteRepo.findByCode.mockResolvedValue({ id: 'i1', conversation_id: 'c1', revoked_at: 'now' })
    await expect(conv.joinByCode(ctx(), 'x')).rejects.toMatchObject({ statusCode: 409 })
    inviteRepo.findByCode.mockResolvedValue({ id: 'i1', conversation_id: 'c1', revoked_at: null, expires_at: '2000-01-01T00:00:00Z' })
    await expect(conv.joinByCode(ctx(), 'x')).rejects.toMatchObject({ statusCode: 409 })
    inviteRepo.findByCode.mockResolvedValue({ id: 'i1', conversation_id: 'c1', revoked_at: null, expires_at: null, max_uses: 1, uses: 1 })
    await expect(conv.joinByCode(ctx(), 'x')).rejects.toMatchObject({ statusCode: 409 })
  })
  it('joinByCode blocked for banned users', async () => {
    banRepo.isBanned.mockResolvedValue(true)
    await expect(conv.joinByCode(ctx(), 'x')).rejects.toMatchObject({ statusCode: 403 })
  })
})

// ── public groups ────────────────────────────────────────────────────────────
describe('public groups', () => {
  it('listPublic delegates to repo', async () => {
    convRepo.listPublic.mockResolvedValue([{ id: 'c1' }])
    expect(await conv.listPublic(ctx(), {})).toEqual([{ id: 'c1' }])
  })
  it('joinPublic adds member to a public group', async () => {
    convRepo.findById.mockResolvedValue({ id: 'c1', type: 'group', is_public: true, status: 'active' })
    const out = await conv.joinPublic(ctx(), 'c1')
    expect(partRepo.insert).toHaveBeenCalled()
    expect(out.id).toBe('c1')
  })
  it('joinPublic rejects non-public', async () => {
    convRepo.findById.mockResolvedValue({ id: 'c1', type: 'group', is_public: false, status: 'active' })
    await expect(conv.joinPublic(ctx(), 'c1')).rejects.toMatchObject({ statusCode: 409 })
  })
})

// ── support queue routing ──────────────────────────────────────────────────
describe('setQueue', () => {
  it('staff sets a queue', async () => {
    convRepo.findById.mockResolvedValue({ id: 'c1', type: 'support' })
    convRepo.update.mockResolvedValue({ id: 'c1', queue: 'billing' })
    const out = await conv.setQueue(staff(), 'c1', 'billing')
    expect(out.queue).toBe('billing')
  })
  it('rejects non-support', async () => {
    convRepo.findById.mockResolvedValue({ id: 'c1', type: 'group' })
    await expect(conv.setQueue(staff(), 'c1', 'x')).rejects.toMatchObject({ statusCode: 409 })
  })
})

// ── create: ban + DM-request flag ────────────────────────────────────────────
describe('create — ban + dm_requests', () => {
  beforeEach(() => {
    convRepo.insert.mockImplementation(async (_c, conv) => ({ id: 'c1', type: conv.type, ...conv }))
    partRepo.insert.mockImplementation(async (_c, p) => ({ ...p, user_id: p.userId, left_at: null }))
  })
  it('banned user cannot create', async () => {
    banRepo.isBanned.mockResolvedValue(true)
    await expect(conv.create(ctx(), { type: 'direct', participantIds: ['other'] })).rejects.toMatchObject({ statusCode: 403 })
  })
  it('direct marked as request when dm_requests on', async () => {
    resolveSettings.mockResolvedValue({ dm_requests: true, allow_groups: true, max_group_size: 256, support_enabled: true })
    convRepo.findByDedupe.mockResolvedValue(null)
    await conv.create(ctx(), { type: 'direct', participantIds: ['other'] })
    expect(convRepo.insert.mock.calls[0][1].isRequest).toBe(true)
  })
})

// ── messages: forward / thread / delivered / pins / scheduled ────────────────
describe('messages — new', () => {
  beforeEach(() => {
    convRepo.findById.mockResolvedValue({ id: 'c1', status: 'active' })
    msgRepo.findById.mockResolvedValue({ id: 'm1', conversation_id: 'c1', sender_user_id: 'me', body: 'hello', deleted_at: null })
    msgRepo.insert.mockImplementation(async (_c, m) => ({ id: 'm2', created_at: 'now', ...m }))
  })
  it('forward reposts the body into the target', async () => {
    const out = await msg.forward(ctx(), 'c1', 'm1', 'c2')
    expect(out.id).toBe('m2')
  })
  it('forward rejects same-conversation', async () => {
    await expect(msg.forward(ctx(), 'c1', 'm1', 'c1')).rejects.toMatchObject({ statusCode: 422 })
  })
  it('listThread returns thread rows', async () => {
    msgRepo.findById.mockResolvedValue({ id: 'root', conversation_id: 'c1' })
    msgRepo.listThread.mockResolvedValue([{ id: 'root' }, { id: 'r1' }])
    expect(await msg.listThread(ctx(), 'c1', 'root')).toHaveLength(2)
  })
  it('markDelivered sets the marker + emits', async () => {
    partRepo.setDelivered.mockResolvedValue({ user_id: 'me', last_delivered_at: 'now' })
    await msg.markDelivered(ctx(), 'c1', 'm1')
    expect(realtime.emit).toHaveBeenCalledWith(expect.any(Object), ['other'], expect.objectContaining({ type: 'delivered.updated' }))
  })
  it('pin / unpin / listPins', async () => {
    await msg.pin(ctx(), 'c1', 'm1')
    expect(pinRepo.add).toHaveBeenCalled()
    expect(realtime.emit).toHaveBeenCalledWith(expect.any(Object), ['other'], expect.objectContaining({ type: 'pin.changed' }))
    await msg.unpin(ctx(), 'c1', 'm1')
    expect(pinRepo.remove).toHaveBeenCalled()
    pinRepo.listForConversation.mockResolvedValue([{ message_id: 'm1' }])
    expect(await msg.listPins(ctx(), 'c1')).toHaveLength(1)
  })
  it('banned words are rejected', async () => {
    resolveSettings.mockResolvedValue({ redaction_enabled: false, banned_words: ['spam'] })
    await expect(msg.postMessage(ctx(), 'c1', { body: 'buy SPAM now' })).rejects.toMatchObject({ statusCode: 422 })
  })
  it('tenant-banned sender is rejected', async () => {
    banRepo.isBanned.mockResolvedValue(true)
    resolveSettings.mockResolvedValue({ redaction_enabled: false })
    await expect(msg.postMessage(ctx(), 'c1', { body: 'hi' })).rejects.toMatchObject({ statusCode: 403 })
  })
  it('scheduled message is parked (no fan-out)', async () => {
    resolveSettings.mockResolvedValue({ redaction_enabled: false })
    const future = new Date(Date.now() + 3600_000).toISOString()
    await msg.postMessage(ctx(), 'c1', { body: 'later', scheduledFor: future })
    expect(msgRepo.insert.mock.calls[0][1].status).toBe('scheduled')
    expect(realtime.emit).not.toHaveBeenCalled()
    expect(convRepo.bumpLastMessageAt).not.toHaveBeenCalled()
  })
  it('attachment kind validated against tenant allow-list', async () => {
    resolveSettings.mockResolvedValue({ allowed_attachment_kinds: ['image'] })
    await expect(msg.attach(ctx(), 'c1', 'm1', { objectId: 'o1', kind: 'video' })).rejects.toMatchObject({ statusCode: 422 })
  })
})

// ── deliverScheduledFor ──────────────────────────────────────────────────────
describe('deliverScheduledFor', () => {
  it('delivers a due message + fans out', async () => {
    msgRepo.deliverScheduled.mockResolvedValue({ id: 'm1', conversation_id: 'c1', sender_user_id: 'me', metadata: { mentions: ['other'] }, created_at: 'now' })
    partRepo.list.mockResolvedValue(PARTS)
    const out = await msg.deliverScheduledFor({ appId: 'platform', tenantId: 't1', messageId: 'm1' })
    expect(out.id).toBe('m1')
    expect(msgRepo.insertMentions).toHaveBeenCalled()
    expect(realtime.emit).toHaveBeenCalledWith(expect.any(Object), ['other'], expect.objectContaining({ type: 'message.created' }))
  })
  it('no-op when the message was already delivered', async () => {
    msgRepo.deliverScheduled.mockResolvedValue(null)
    expect(await msg.deliverScheduledFor({ appId: 'platform', tenantId: 't1', messageId: 'm1' })).toBeNull()
  })
})

// ── support CSAT + macros ────────────────────────────────────────────────────
describe('support CSAT + macros', () => {
  it('submitCsat by a participant', async () => {
    convRepo.findById.mockResolvedValue({ id: 'c1', type: 'support' })
    csatRepo.insert.mockResolvedValue({ id: 'cs1', rating: 5 })
    const out = await support.submitCsat(ctx(), 'c1', { rating: 5 })
    expect(out.rating).toBe(5)
  })
  it('submitCsat rejects non-support', async () => {
    convRepo.findById.mockResolvedValue({ id: 'c1', type: 'group' })
    await expect(support.submitCsat(ctx(), 'c1', { rating: 5 })).rejects.toMatchObject({ statusCode: 409 })
  })
  it('getCsat requires staff', async () => {
    await expect(support.getCsat(ctx(), 'c1')).rejects.toMatchObject({ statusCode: 403 })
    csatRepo.getForConversation.mockResolvedValue([])
    expect(await support.getCsat(staff(), 'c1')).toEqual([])
  })
  it('macros CRUD require staff', async () => {
    await expect(support.listMacros(ctx())).rejects.toMatchObject({ statusCode: 403 })
    macroRepo.list.mockResolvedValue([])
    expect(await support.listMacros(staff())).toEqual([])
    macroRepo.insert.mockResolvedValue({ id: 'mm1' })
    expect((await support.createMacro(staff(), { title: 'T', body: 'B' })).id).toBe('mm1')
    macroRepo.remove.mockResolvedValue(true)
    expect(await support.deleteMacro(staff(), 'mm1')).toEqual({ ok: true })
    macroRepo.remove.mockResolvedValue(false)
    await expect(support.deleteMacro(staff(), 'ghost')).rejects.toMatchObject({ statusCode: 404 })
  })
})

// ── moderation bans + admin ──────────────────────────────────────────────────
describe('tenant bans + admin', () => {
  it('banUser requires staff + not self', async () => {
    await expect(moderation.banUser(ctx(), 'x')).rejects.toMatchObject({ statusCode: 403 })
    await expect(moderation.banUser(staff(), 's1')).rejects.toMatchObject({ statusCode: 422 })
    banRepo.add.mockResolvedValue({ user_id: 'x' })
    expect((await moderation.banUser(staff(), 'x', 'spam')).user_id).toBe('x')
  })
  it('unbanUser + listBans (staff)', async () => {
    banRepo.remove.mockResolvedValue(true)
    await moderation.unbanUser(staff(), 'x')
    expect(banRepo.remove).toHaveBeenCalled()
    banRepo.list.mockResolvedValue([{ user_id: 'x' }])
    expect(await moderation.listBans(staff())).toHaveLength(1)
  })
  it('admin.metrics + exportConversation require staff', async () => {
    await expect(admin.metrics(ctx())).rejects.toMatchObject({ statusCode: 403 })
    convRepo.metrics.mockResolvedValue({ direct_count: 1 })
    expect((await admin.metrics(staff())).direct_count).toBe(1)
    convRepo.findById.mockResolvedValue({ id: 'c1' })
    convRepo.exportMessages.mockResolvedValue([{ id: 'm1' }])
    const out = await admin.exportConversation(staff(), 'c1')
    expect(out.messages).toHaveLength(1)
  })
})
