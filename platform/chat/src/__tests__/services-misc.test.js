import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({ env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z' } }))
vi.mock('../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../lib/db.js', () => ({ withTenantTransaction: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ getRedis: vi.fn() }))
vi.mock('../repositories/conversations.repository.js')
vi.mock('../repositories/participants.repository.js')
vi.mock('../repositories/blocks.repository.js')
vi.mock('../repositories/reports.repository.js')
vi.mock('../repositories/messages.repository.js')
vi.mock('../repositories/settings.repository.js')
vi.mock('../services/realtime.service.js', () => ({ emit: vi.fn().mockResolvedValue(), notify: vi.fn().mockResolvedValue() }))
vi.mock('../services/conversations.service.js', () => ({ create: vi.fn() }))

import * as support from '../services/support.service.js'
import * as moderation from '../services/moderation.service.js'
import * as search from '../services/search.service.js'
import * as presence from '../services/presence.service.js'
import * as settings from '../services/settings.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { getRedis } from '../lib/redis.js'
import * as convRepo from '../repositories/conversations.repository.js'
import * as partRepo from '../repositories/participants.repository.js'
import * as blockRepo from '../repositories/blocks.repository.js'
import * as reportRepo from '../repositories/reports.repository.js'
import * as msgRepo from '../repositories/messages.repository.js'
import * as settingsRepo from '../repositories/settings.repository.js'
import * as realtime from '../services/realtime.service.js'
import { create as createConversation } from '../services/conversations.service.js'

const staff = { userId: 's', appId: 'platform', tenantId: 't1', subTenantId: null, role: 'staff' }
const user = { userId: 'u', appId: 'platform', tenantId: 't1', subTenantId: null, role: 'user' }

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_a, _t, _s, fn) => fn({}))
})

describe('support.service', () => {
  it('open delegates to conversations.create with type support', async () => {
    createConversation.mockResolvedValue({ id: 'c1', type: 'support' })
    const out = await support.open(user, { subject: 'Help', priority: 'high', agentIds: ['a1'] })
    expect(createConversation).toHaveBeenCalledWith(user, expect.objectContaining({ type: 'support', subject: 'Help' }))
    expect(out.id).toBe('c1')
  })
  it('queue requires staff', async () => {
    await expect(support.queue(user, {})).rejects.toMatchObject({ statusCode: 403 })
    convRepo.listSupportQueue.mockResolvedValue([{ id: 'c1' }])
    expect(await support.queue(staff, {})).toEqual([{ id: 'c1' }])
  })
  it('assign adds agent participant + notifies', async () => {
    convRepo.findById.mockResolvedValue({ id: 'c1', type: 'support', support_status: 'open' })
    convRepo.update.mockResolvedValue({ id: 'c1', assigned_agent_user_id: 'a1', support_status: 'pending' })
    partRepo.list.mockResolvedValue([{ user_id: 'u' }, { user_id: 'a1' }])
    const out = await support.assign(staff, 'c1', 'a1')
    expect(partRepo.insert).toHaveBeenCalled()
    expect(out.support_status).toBe('pending')
    expect(realtime.notify).toHaveBeenCalledWith('chat.support.assigned', expect.objectContaining({ agentUserId: 'a1' }))
  })
  it('assign rejects non-support conversations', async () => {
    convRepo.findById.mockResolvedValue({ id: 'c1', type: 'group' })
    await expect(support.assign(staff, 'c1', 'a1')).rejects.toMatchObject({ statusCode: 409 })
  })
  it('updateSupport sets status/priority', async () => {
    convRepo.findById.mockResolvedValue({ id: 'c1', type: 'support' })
    convRepo.update.mockResolvedValue({ id: 'c1', support_status: 'resolved' })
    partRepo.list.mockResolvedValue([{ user_id: 'u' }])
    const out = await support.updateSupport(staff, 'c1', { supportStatus: 'resolved' })
    expect(out.support_status).toBe('resolved')
  })
})

describe('moderation.service', () => {
  it('cannot block yourself', async () => {
    await expect(moderation.block(user, 'u')).rejects.toMatchObject({ statusCode: 422 })
  })
  it('block / unblock / listBlocks', async () => {
    blockRepo.add.mockResolvedValue({ blocked_user_id: 'b' })
    expect((await moderation.block(user, 'b')).blocked_user_id).toBe('b')
    await moderation.unblock(user, 'b')
    expect(blockRepo.remove).toHaveBeenCalled()
    blockRepo.listForUser.mockResolvedValue([{ blocked_user_id: 'b' }])
    expect(await moderation.listBlocks(user)).toHaveLength(1)
  })
  it('report inserts + notifies', async () => {
    reportRepo.insert.mockResolvedValue({ id: 'r1', target_type: 'message', target_id: 'm1' })
    const out = await moderation.report(user, { targetType: 'message', targetId: 'm1', reason: 'spam' })
    expect(out.id).toBe('r1')
    expect(realtime.notify).toHaveBeenCalledWith('chat.message.reported', expect.objectContaining({ reportId: 'r1' }))
  })
  it('listReports requires staff; updateReport too', async () => {
    await expect(moderation.listReports(user, {})).rejects.toMatchObject({ statusCode: 403 })
    reportRepo.list.mockResolvedValue([])
    expect(await moderation.listReports(staff, {})).toEqual([])
    reportRepo.updateStatus.mockResolvedValue({ id: 'r1', status: 'reviewed' })
    expect((await moderation.updateReport(staff, 'r1', 'reviewed')).status).toBe('reviewed')
  })
  it('updateReport 404 when missing', async () => {
    reportRepo.updateStatus.mockResolvedValue(null)
    await expect(moderation.updateReport(staff, 'ghost', 'reviewed')).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('search.service', () => {
  it('rejects empty query', async () => {
    await expect(search.search(user, '   ')).rejects.toMatchObject({ statusCode: 422 })
  })
  it('delegates to repo', async () => {
    msgRepo.search.mockResolvedValue([{ id: 'm1' }])
    expect(await search.search(user, 'hi', 10)).toEqual([{ id: 'm1' }])
  })
})

describe('settings.service', () => {
  it('resolve returns defaults when no row', async () => {
    settingsRepo.find.mockResolvedValue(null)
    const out = await settings.resolve({}, 'platform', 't1')
    expect(out).toMatchObject({ allow_groups: true, redaction_enabled: false, support_enabled: true })
  })
  it('getForTenant resolves', async () => {
    settingsRepo.find.mockResolvedValue({ app_id: 'platform', allow_groups: false })
    const out = await settings.getForTenant(user)
    expect(out.allow_groups).toBe(false)
  })
  it('upsertForTenant requires staff', async () => {
    await expect(settings.upsertForTenant(user, {})).rejects.toMatchObject({ statusCode: 403 })
    settingsRepo.upsert.mockResolvedValue({ app_id: 'platform' })
    expect(await settings.upsertForTenant(staff, { allowGroups: false })).toBeDefined()
  })
})

describe('presence.service', () => {
  it('heartbeat no-op without redis', async () => {
    getRedis.mockReturnValue(null)
    expect(await presence.heartbeat(user)).toEqual({ transitioned: false })
  })
  it('heartbeat detects transition online', async () => {
    const redis = { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue('OK'), del: vi.fn(), mget: vi.fn() }
    getRedis.mockReturnValue(redis)
    const out = await presence.heartbeat(user)
    expect(redis.set).toHaveBeenCalledWith(expect.stringContaining('chat:presence:'), 'online', 'EX', 60)
    expect(out.transitioned).toBe(true)
  })
  it('snapshot maps missing keys to offline', async () => {
    const redis = { mget: vi.fn().mockResolvedValue(['online', null]) }
    getRedis.mockReturnValue(redis)
    const out = await presence.snapshot(user, ['a', 'b'])
    expect(out).toEqual([{ userId: 'a', status: 'online' }, { userId: 'b', status: 'offline' }])
  })
  it('snapshot offline list without redis', async () => {
    getRedis.mockReturnValue(null)
    expect(await presence.snapshot(user, ['a'])).toEqual([{ userId: 'a', status: 'offline' }])
  })
  it('setOffline deletes the key', async () => {
    const redis = { del: vi.fn().mockResolvedValue(1) }
    getRedis.mockReturnValue(redis)
    await presence.setOffline(user)
    expect(redis.del).toHaveBeenCalled()
  })
  it('broadcastPresence emits to co-participants', async () => {
    getRedis.mockReturnValue(null)
    partRepo.coParticipantUserIds.mockResolvedValue(['x', 'y'])
    await presence.broadcastPresence(user, 'online')
    expect(realtime.emit).toHaveBeenCalledWith(user, ['x', 'y'], expect.objectContaining({ type: 'presence' }))
  })
  it('broadcastPresence no-op when no co-participants', async () => {
    partRepo.coParticipantUserIds.mockResolvedValue([])
    await presence.broadcastPresence(user, 'online')
    expect(realtime.emit).not.toHaveBeenCalled()
  })
  it('typing verifies participant + emits + writes typing key', async () => {
    const redis = { set: vi.fn().mockResolvedValue('OK'), del: vi.fn().mockResolvedValue(1) }
    getRedis.mockReturnValue(redis)
    partRepo.find.mockResolvedValue({ user_id: 'u', role: 'member', left_at: null })
    partRepo.list.mockResolvedValue([{ user_id: 'u' }, { user_id: 'x' }])
    await presence.typing(user, 'c1', true)
    expect(redis.set).toHaveBeenCalledWith(expect.stringContaining('chat:typing:'), '1', 'EX', 6)
    expect(realtime.emit).toHaveBeenCalledWith(user, ['x'], expect.objectContaining({ type: 'typing' }))
    await presence.typing(user, 'c1', false)
    expect(redis.del).toHaveBeenCalled()
  })
  it('typing rejects non-participants', async () => {
    getRedis.mockReturnValue(null)
    partRepo.find.mockResolvedValue(null)
    await expect(presence.typing(user, 'c1', true)).rejects.toMatchObject({ statusCode: 403 })
  })
})
