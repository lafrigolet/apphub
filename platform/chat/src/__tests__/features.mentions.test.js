import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({ env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', PLATFORM_CORE_BASE_URL: 'http://core:3000' } }))
vi.mock('../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../services/presence.service.js', () => ({ snapshot: vi.fn() }))

import * as mentions from '../services/mentions.service.js'
import * as presence from '../services/presence.service.js'

const ctx = { userId: 'me', appId: 'platform', tenantId: 't1', subTenantId: null }
const participants = [
  { user_id: 'me', role: 'owner', left_at: null },
  { user_id: 'a', role: 'admin', left_at: null },
  { user_id: 'b', role: 'member', left_at: null },
  { user_id: 'gone', role: 'member', left_at: '2026-01-01' },
]

beforeEach(() => vi.clearAllMocks())

describe('mentions.resolve', () => {
  it('explicit mentions filtered to active participants (excludes self + left)', async () => {
    const out = await mentions.resolve({ ctx, participants, input: { mentions: ['a', 'me', 'gone', 'stranger'] } })
    expect(out.sort()).toEqual(['a'])
  })

  it('scope "all" expands to active participants minus self', async () => {
    const out = await mentions.resolve({ ctx, participants, input: { mentionScope: 'all' } })
    expect(out.sort()).toEqual(['a', 'b'])
  })

  it('scope "here" uses presence to pick online participants', async () => {
    presence.snapshot.mockResolvedValue([
      { userId: 'me', status: 'online' }, { userId: 'a', status: 'online' }, { userId: 'b', status: 'offline' },
    ])
    const out = await mentions.resolve({ ctx, participants, input: { mentionScope: 'here' } })
    expect(out).toEqual(['a'])
  })

  it('conversation-role mentions resolve locally', async () => {
    const out = await mentions.resolve({ ctx, participants, input: { mentionRoles: ['admin'] } })
    expect(out).toEqual(['a'])
  })

  it('app-role mentions call auth and intersect with participants', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ([{ id: 'a' }, { id: 'outsider' }]) })
    vi.stubGlobal('fetch', fetchMock)
    const out = await mentions.resolve({ ctx, participants, input: { mentionAppRoles: ['staff'] }, bearerToken: 'tok' })
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/v1/users?tenantId=t1'), expect.objectContaining({ headers: { Authorization: 'Bearer tok' } }))
    expect(out).toEqual(['a'])
    vi.unstubAllGlobals()
  })

  it('app-role mentions resolve to empty without a token or on error', async () => {
    expect(await mentions.resolve({ ctx, participants, input: { mentionAppRoles: ['staff'] } })).toEqual([])
    const fetchMock = vi.fn().mockResolvedValue({ ok: false })
    vi.stubGlobal('fetch', fetchMock)
    expect(await mentions.resolve({ ctx, participants, input: { mentionAppRoles: ['staff'] }, bearerToken: 't' })).toEqual([])
    vi.unstubAllGlobals()
  })
})
