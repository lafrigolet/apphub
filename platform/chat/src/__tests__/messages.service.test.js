import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({ env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z' } }))
vi.mock('../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../lib/db.js', () => ({ withTenantTransaction: vi.fn() }))
vi.mock('../lib/ratelimit.js', () => ({ enforceRate: vi.fn().mockResolvedValue() }))
vi.mock('../repositories/messages.repository.js')
vi.mock('../repositories/participants.repository.js')
vi.mock('../repositories/conversations.repository.js')
vi.mock('../repositories/reactions.repository.js')
vi.mock('../repositories/attachments.repository.js')
vi.mock('../repositories/bans.repository.js')
vi.mock('../repositories/pins.repository.js')
vi.mock('../services/realtime.service.js', () => ({ emit: vi.fn().mockResolvedValue(), notify: vi.fn().mockResolvedValue() }))
vi.mock('../services/mentions.service.js', () => ({ resolve: vi.fn() }))
vi.mock('../services/settings.service.js', () => ({ resolve: vi.fn() }))

import * as svc from '../services/messages.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { enforceRate } from '../lib/ratelimit.js'
import * as msgRepo from '../repositories/messages.repository.js'
import * as partRepo from '../repositories/participants.repository.js'
import * as convRepo from '../repositories/conversations.repository.js'
import * as reactionRepo from '../repositories/reactions.repository.js'
import * as attachmentRepo from '../repositories/attachments.repository.js'
import * as banRepo from '../repositories/bans.repository.js'
import * as realtime from '../services/realtime.service.js'
import * as mentions from '../services/mentions.service.js'
import { resolve as resolveSettings } from '../services/settings.service.js'

const ctx = (o = {}) => ({ userId: 'me', appId: 'platform', tenantId: 't1', subTenantId: null, role: 'user', ...o })
const PARTS = [{ user_id: 'me', left_at: null, role: 'member' }, { user_id: 'other', left_at: null, role: 'member' }]

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_a, _t, _s, fn) => fn({}))
  resolveSettings.mockResolvedValue({ redaction_enabled: false })
  banRepo.isBanned.mockResolvedValue(false)
  mentions.resolve.mockResolvedValue([])
  convRepo.findById.mockResolvedValue({ id: 'c1', status: 'active' })
  partRepo.find.mockResolvedValue({ user_id: 'me', role: 'member', left_at: null })
  partRepo.list.mockResolvedValue(PARTS)
  msgRepo.insert.mockImplementation(async (_c, m) => ({ id: 'm1', created_at: 'now', ...m, body: m.body }))
})

describe('postMessage', () => {
  it('requires a body for text messages', async () => {
    await expect(svc.postMessage(ctx(), 'c1', {})).rejects.toMatchObject({ statusCode: 422 })
  })

  it('rejects posting to an archived conversation', async () => {
    convRepo.findById.mockResolvedValue({ id: 'c1', status: 'archived' })
    await expect(svc.postMessage(ctx(), 'c1', { body: 'hi' })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('rejects non-participants', async () => {
    partRepo.find.mockResolvedValue(null)
    await expect(svc.postMessage(ctx(), 'c1', { body: 'hi' })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('inserts, bumps last_message_at, emits + notifies recipients (excludes sender)', async () => {
    const out = await svc.postMessage(ctx(), 'c1', { body: 'hi' })
    expect(out.id).toBe('m1')
    expect(enforceRate).toHaveBeenCalled()
    expect(convRepo.bumpLastMessageAt).toHaveBeenCalledWith({}, 'c1', 'now')
    expect(realtime.emit).toHaveBeenCalledWith(expect.any(Object), ['other'], expect.objectContaining({ type: 'message.created' }))
    expect(realtime.notify).toHaveBeenCalledWith('chat.message.created', expect.objectContaining({ recipientUserIds: ['other'] }))
  })

  it('applies redaction when enabled', async () => {
    resolveSettings.mockResolvedValue({ redaction_enabled: true })
    await svc.postMessage(ctx(), 'c1', { body: 'mail me a@b.com' })
    expect(msgRepo.insert.mock.calls[0][1].body).toContain('[email oculto]')
  })

  it('persists resolved mentions and notifies each', async () => {
    mentions.resolve.mockResolvedValue(['other'])
    await svc.postMessage(ctx(), 'c1', { body: 'hi', mentions: ['other', 'stranger'] })
    expect(msgRepo.insertMentions).toHaveBeenCalledWith({}, expect.any(Object), ['other'])
    expect(realtime.notify).toHaveBeenCalledWith('chat.mention.created', expect.objectContaining({ mentionedUserId: 'other' }))
  })
})

describe('editMessage', () => {
  it('only the sender can edit', async () => {
    msgRepo.findById.mockResolvedValue({ id: 'm1', conversation_id: 'c1', sender_user_id: 'other' })
    await expect(svc.editMessage(ctx(), 'c1', 'm1', 'new')).rejects.toMatchObject({ statusCode: 403 })
  })
  it('edits own message and emits update', async () => {
    msgRepo.findById.mockResolvedValue({ id: 'm1', conversation_id: 'c1', sender_user_id: 'me' })
    msgRepo.updateBody.mockResolvedValue({ id: 'm1', body: 'new', edited_at: 'now' })
    const out = await svc.editMessage(ctx(), 'c1', 'm1', 'new')
    expect(out.body).toBe('new')
    expect(realtime.emit).toHaveBeenCalledWith(expect.any(Object), ['other'], expect.objectContaining({ type: 'message.updated' }))
  })
})

describe('deleteMessage', () => {
  it('sender can delete', async () => {
    msgRepo.findById.mockResolvedValue({ id: 'm1', conversation_id: 'c1', sender_user_id: 'me' })
    msgRepo.softDelete.mockResolvedValue({ id: 'm1', deleted_at: 'now' })
    await svc.deleteMessage(ctx(), 'c1', 'm1')
    expect(realtime.emit).toHaveBeenCalledWith(expect.any(Object), ['other'], expect.objectContaining({ type: 'message.deleted' }))
  })
  it('a plain member cannot delete others; an admin can', async () => {
    msgRepo.findById.mockResolvedValue({ id: 'm1', conversation_id: 'c1', sender_user_id: 'other' })
    partRepo.find.mockResolvedValue({ user_id: 'me', role: 'member', left_at: null })
    await expect(svc.deleteMessage(ctx(), 'c1', 'm1')).rejects.toMatchObject({ statusCode: 403 })
    partRepo.find.mockResolvedValue({ user_id: 'me', role: 'admin', left_at: null })
    msgRepo.softDelete.mockResolvedValue({ id: 'm1', deleted_at: 'now' })
    await expect(svc.deleteMessage(ctx(), 'c1', 'm1')).resolves.toBeDefined()
  })
  it('staff can delete any message', async () => {
    msgRepo.findById.mockResolvedValue({ id: 'm1', conversation_id: 'c1', sender_user_id: 'other' })
    partRepo.find.mockResolvedValue(null)
    msgRepo.softDelete.mockResolvedValue({ id: 'm1', deleted_at: 'now' })
    await expect(svc.deleteMessage(ctx({ role: 'staff' }), 'c1', 'm1')).resolves.toBeDefined()
  })
})

describe('read state', () => {
  it('markRead sets the marker and emits read.updated', async () => {
    partRepo.setLastRead.mockResolvedValue({ user_id: 'me', last_read_at: 'now' })
    await svc.markRead(ctx(), 'c1', 'm1')
    expect(partRepo.setLastRead).toHaveBeenCalledWith({}, 'c1', 'me', 'm1', expect.any(String))
    expect(realtime.emit).toHaveBeenCalledWith(expect.any(Object), ['other'], expect.objectContaining({ type: 'read.updated' }))
  })
  it('unread delegates to repo', async () => {
    msgRepo.unreadSummary.mockResolvedValue([{ conversation_id: 'c1', unread_count: 3 }])
    expect(await svc.unread(ctx())).toEqual([{ conversation_id: 'c1', unread_count: 3 }])
  })
})

describe('reactions', () => {
  beforeEach(() => {
    msgRepo.findById.mockResolvedValue({ id: 'm1', conversation_id: 'c1' })
    reactionRepo.listForMessage.mockResolvedValue([{ emoji: '👍', count: 1 }])
  })
  it('add emits reaction.changed', async () => {
    await svc.addReaction(ctx(), 'c1', 'm1', '👍')
    expect(reactionRepo.add).toHaveBeenCalled()
    expect(realtime.emit).toHaveBeenCalledWith(expect.any(Object), ['other'], expect.objectContaining({ type: 'reaction.changed' }))
  })
  it('remove emits reaction.changed', async () => {
    await svc.removeReaction(ctx(), 'c1', 'm1', '👍')
    expect(reactionRepo.remove).toHaveBeenCalledWith({}, 'm1', 'me', '👍')
  })
})

describe('attachments', () => {
  beforeEach(() => {
    msgRepo.findById.mockResolvedValue({ id: 'm1', conversation_id: 'c1', sender_user_id: 'me' })
  })
  it('attach: only sender (or staff)', async () => {
    msgRepo.findById.mockResolvedValue({ id: 'm1', conversation_id: 'c1', sender_user_id: 'other' })
    await expect(svc.attach(ctx(), 'c1', 'm1', { objectId: 'o1', kind: 'image' })).rejects.toMatchObject({ statusCode: 403 })
  })
  it('attach succeeds for sender + emits', async () => {
    attachmentRepo.insert.mockResolvedValue({ id: 'a1', object_id: 'o1' })
    const out = await svc.attach(ctx(), 'c1', 'm1', { objectId: 'o1', kind: 'image' })
    expect(out.id).toBe('a1')
    expect(realtime.emit).toHaveBeenCalled()
  })
  it('listAttachments returns rows', async () => {
    attachmentRepo.listForMessage.mockResolvedValue([{ id: 'a1' }])
    expect(await svc.listAttachments(ctx(), 'c1', 'm1')).toEqual([{ id: 'a1' }])
  })
  it('detach: sender removes; mismatched message → 404', async () => {
    attachmentRepo.findById.mockResolvedValue({ id: 'a1', message_id: 'other' })
    await expect(svc.detach(ctx(), 'c1', 'm1', 'a1')).rejects.toMatchObject({ statusCode: 404 })
    attachmentRepo.findById.mockResolvedValue({ id: 'a1', message_id: 'm1' })
    await expect(svc.detach(ctx(), 'c1', 'm1', 'a1')).resolves.toBeUndefined()
    expect(attachmentRepo.remove).toHaveBeenCalledWith({}, 'a1')
  })
})
