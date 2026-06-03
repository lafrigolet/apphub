import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({ env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z' } }))
vi.mock('../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../lib/db.js', () => ({ withTenantTransaction: vi.fn() }))
vi.mock('../repositories/conversations.repository.js')
vi.mock('../repositories/participants.repository.js')
vi.mock('../repositories/messages.repository.js')
vi.mock('../repositories/blocks.repository.js')
vi.mock('../repositories/bans.repository.js')
vi.mock('../repositories/invites.repository.js')
vi.mock('../services/realtime.service.js', () => ({ emit: vi.fn().mockResolvedValue(), notify: vi.fn().mockResolvedValue() }))
vi.mock('../services/settings.service.js', () => ({ resolve: vi.fn() }))

import * as svc from '../services/conversations.service.js'
import { withTenantTransaction } from '../lib/db.js'
import * as convRepo from '../repositories/conversations.repository.js'
import * as partRepo from '../repositories/participants.repository.js'
import * as blockRepo from '../repositories/blocks.repository.js'
import * as banRepo from '../repositories/bans.repository.js'
import * as realtime from '../services/realtime.service.js'
import { resolve as resolveSettings } from '../services/settings.service.js'

const APP = 'platform'
const TENANT = '22222222-2222-2222-2222-222222222222'
const ctx = (o = {}) => ({ userId: 'me', appId: APP, tenantId: TENANT, subTenantId: null, role: 'user', ...o })

const SETTINGS = { allow_groups: true, max_group_size: 256, support_enabled: true, redaction_enabled: false }

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_a, _t, _s, fn) => fn({}))
  resolveSettings.mockResolvedValue(SETTINGS)
  banRepo.isBanned.mockResolvedValue(false)
  convRepo.insert.mockImplementation(async (_c, conv) => ({ id: 'c1', type: conv.type, ...conv }))
  partRepo.insert.mockImplementation(async (_c, p) => ({ ...p, user_id: p.userId, left_at: null, role: p.role }))
  partRepo.list.mockResolvedValue([{ user_id: 'me', left_at: null }, { user_id: 'other', left_at: null }])
})

describe('create — direct', () => {
  it('requires exactly one other participant', async () => {
    await expect(svc.create(ctx(), { type: 'direct', participantIds: [] })).rejects.toMatchObject({ statusCode: 422 })
  })

  it('rejects when the pair is blocked', async () => {
    blockRepo.existsBetween.mockResolvedValue(true)
    await expect(svc.create(ctx(), { type: 'direct', participantIds: ['other'] })).rejects.toMatchObject({ statusCode: 409 })
  })

  it('creates a new direct conversation with a dedupe key + two participants', async () => {
    blockRepo.existsBetween.mockResolvedValue(false)
    convRepo.findByDedupe.mockResolvedValue(null)
    const out = await svc.create(ctx(), { type: 'direct', participantIds: ['other'] })
    expect(out.type).toBe('direct')
    expect(convRepo.insert.mock.calls[0][1].dedupeKey).toBe(['me', 'other'].sort().join(':'))
    expect(partRepo.insert).toHaveBeenCalledTimes(2)
    expect(realtime.notify).toHaveBeenCalledWith('chat.conversation.created', expect.any(Object))
  })

  it('dedups: returns the existing conversation and does not emit created', async () => {
    blockRepo.existsBetween.mockResolvedValue(false)
    convRepo.findByDedupe.mockResolvedValue({ id: 'existing', type: 'direct' })
    partRepo.list.mockResolvedValue([{ user_id: 'me', left_at: null }, { user_id: 'other', left_at: null }])
    const out = await svc.create(ctx(), { type: 'direct', participantIds: ['other'] })
    expect(out.id).toBe('existing')
    expect(convRepo.insert).not.toHaveBeenCalled()
    expect(realtime.notify).not.toHaveBeenCalled()
  })
})

describe('create — group', () => {
  it('requires a title', async () => {
    await expect(svc.create(ctx(), { type: 'group', participantIds: ['a'] })).rejects.toMatchObject({ statusCode: 422 })
  })

  it('rejects when groups are disabled', async () => {
    resolveSettings.mockResolvedValue({ ...SETTINGS, allow_groups: false })
    await expect(svc.create(ctx(), { type: 'group', title: 'T', participantIds: ['a'] })).rejects.toMatchObject({ statusCode: 409 })
  })

  it('rejects when exceeding max group size', async () => {
    resolveSettings.mockResolvedValue({ ...SETTINGS, max_group_size: 2 })
    await expect(svc.create(ctx(), { type: 'group', title: 'T', participantIds: ['a', 'b'] })).rejects.toMatchObject({ statusCode: 422 })
  })

  it('creates the owner + members', async () => {
    const out = await svc.create(ctx(), { type: 'group', title: 'Team', participantIds: ['a', 'b'] })
    expect(out.type).toBe('group')
    expect(partRepo.insert.mock.calls[0][1].role).toBe('owner')
    expect(partRepo.insert).toHaveBeenCalledTimes(3)
  })
})

describe('create — support', () => {
  it('rejects when support disabled', async () => {
    resolveSettings.mockResolvedValue({ ...SETTINGS, support_enabled: false })
    await expect(svc.create(ctx(), { type: 'support' })).rejects.toMatchObject({ statusCode: 409 })
  })
  it('opens an open ticket with the creator as member', async () => {
    const out = await svc.create(ctx(), { type: 'support', subject: 'Help' })
    expect(out.type).toBe('support')
    expect(convRepo.insert.mock.calls[0][1].supportStatus).toBe('open')
  })
  it('rejects unknown type', async () => {
    await expect(svc.create(ctx(), { type: 'bogus' })).rejects.toMatchObject({ statusCode: 422 })
  })
})

describe('get / list / participants', () => {
  it('get enforces participant access', async () => {
    convRepo.findById.mockResolvedValue({ id: 'c1' })
    partRepo.find.mockResolvedValue(null)
    await expect(svc.get(ctx(), 'c1')).rejects.toMatchObject({ statusCode: 403 })
  })
  it('get returns conversation + participants for a member', async () => {
    convRepo.findById.mockResolvedValue({ id: 'c1' })
    partRepo.find.mockResolvedValue({ user_id: 'me', role: 'member', left_at: null })
    const out = await svc.get(ctx(), 'c1')
    expect(out.participants).toHaveLength(2)
  })
  it('get 404 when missing', async () => {
    convRepo.findById.mockResolvedValue(null)
    await expect(svc.get(ctx(), 'ghost')).rejects.toMatchObject({ statusCode: 404 })
  })
  it('list delegates to repo', async () => {
    convRepo.listForUser.mockResolvedValue([{ id: 'c1' }])
    expect(await svc.list(ctx(), {})).toEqual([{ id: 'c1' }])
  })
})

describe('update / leave / membership', () => {
  beforeEach(() => {
    convRepo.findById.mockResolvedValue({ id: 'c1', type: 'group' })
    convRepo.update.mockResolvedValue({ id: 'c1', title: 'New' })
  })

  it('update requires manager', async () => {
    partRepo.find.mockResolvedValue({ role: 'member', left_at: null })
    await expect(svc.update(ctx(), 'c1', { title: 'New' })).rejects.toMatchObject({ statusCode: 403 })
  })
  it('update succeeds for owner and emits', async () => {
    partRepo.find.mockResolvedValue({ role: 'owner', left_at: null })
    const out = await svc.update(ctx(), 'c1', { title: 'New' })
    expect(out.title).toBe('New')
    expect(realtime.emit).toHaveBeenCalled()
  })

  it('leave records left_at + system message', async () => {
    partRepo.find.mockResolvedValue({ role: 'member', left_at: null })
    await svc.leave(ctx(), 'c1')
    expect(partRepo.leave).toHaveBeenCalled()
  })

  it('addParticipants rejected on direct', async () => {
    convRepo.findById.mockResolvedValue({ id: 'c1', type: 'direct' })
    partRepo.find.mockResolvedValue({ role: 'owner', left_at: null })
    await expect(svc.addParticipants(ctx(), 'c1', ['x'])).rejects.toMatchObject({ statusCode: 409 })
  })

  it('addParticipants enforces max size', async () => {
    partRepo.find.mockResolvedValue({ role: 'admin', left_at: null })
    partRepo.countActive.mockResolvedValue(256)
    await expect(svc.addParticipants(ctx(), 'c1', ['x'])).rejects.toMatchObject({ statusCode: 422 })
  })

  it('addParticipants adds + emits', async () => {
    partRepo.find.mockResolvedValue({ role: 'admin', left_at: null })
    partRepo.countActive.mockResolvedValue(1)
    const out = await svc.addParticipants(ctx(), 'c1', ['x', 'y'])
    expect(out).toHaveLength(2)
    expect(realtime.emit).toHaveBeenCalled()
  })

  it('updateParticipant: changing role requires manager', async () => {
    partRepo.find.mockResolvedValue({ role: 'member', left_at: null })
    await expect(svc.updateParticipant(ctx(), 'c1', 'target', { role: 'admin' })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('updateParticipant: can only mute yourself', async () => {
    partRepo.find.mockResolvedValue({ role: 'member', left_at: null })
    await expect(svc.updateParticipant(ctx(), 'c1', 'someoneelse', { mutedUntil: '2026-01-01T00:00:00Z' }))
      .rejects.toMatchObject({ statusCode: 409 })
  })

  it('updateParticipant: self mute ok', async () => {
    partRepo.find.mockResolvedValue({ role: 'member', left_at: null })
    partRepo.update.mockResolvedValue({ user_id: 'me', muted_until: 'x' })
    const out = await svc.updateParticipant(ctx(), 'c1', 'me', { mutedUntil: '2026-01-01T00:00:00Z' })
    expect(out.muted_until).toBe('x')
  })

  it('removeParticipant rejected on direct', async () => {
    convRepo.findById.mockResolvedValue({ id: 'c1', type: 'direct' })
    partRepo.find.mockResolvedValue({ role: 'owner', left_at: null })
    await expect(svc.removeParticipant(ctx(), 'c1', 'x')).rejects.toMatchObject({ statusCode: 409 })
  })

  it('removeParticipant by manager emits', async () => {
    partRepo.find.mockResolvedValue({ role: 'owner', left_at: null })
    partRepo.leave.mockResolvedValue({ user_id: 'x' })
    await svc.removeParticipant(ctx(), 'c1', 'x')
    expect(realtime.emit).toHaveBeenCalled()
  })
})

describe('loadForAccess', () => {
  it('returns the conversation + caller participant row', async () => {
    convRepo.findById.mockResolvedValue({ id: 'c1' })
    partRepo.find.mockResolvedValue({ user_id: 'me', role: 'member', left_at: null })
    const out = await svc.loadForAccess({}, ctx(), 'c1')
    expect(out.conv.id).toBe('c1')
    expect(out.me.user_id).toBe('me')
  })
  it('throws 404 when the conversation is missing', async () => {
    convRepo.findById.mockResolvedValue(null)
    await expect(svc.loadForAccess({}, ctx(), 'ghost')).rejects.toMatchObject({ statusCode: 404 })
  })
})
