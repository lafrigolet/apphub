import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as repo from '../repositories/preferences.repository.js'

function mkClient(result = { rows: [], rowCount: 0 }) {
  return { query: vi.fn().mockResolvedValue(result) }
}

beforeEach(() => vi.clearAllMocks())

describe('listForUser', () => {
  it('selects muted rows for the user', async () => {
    const c = mkClient({ rows: [{ category: 'orders', channel: '*', muted: true }] })
    const r = await repo.listForUser(c, 'u1')
    expect(r).toHaveLength(1)
    expect(c.query.mock.calls[0][1]).toEqual(['u1'])
  })
})

describe('isMutedFor', () => {
  it('true when a matching muted row exists', async () => {
    const c = mkClient({ rows: [{ '?column?': 1 }] })
    expect(await repo.isMutedFor(c, { userId: 'u1', category: 'orders', channel: 'email' })).toBe(true)
    expect(c.query.mock.calls[0][1]).toEqual(['u1', 'orders', 'email'])
  })
  it('false when none', async () => {
    const c = mkClient({ rows: [] })
    expect(await repo.isMutedFor(c, { userId: 'u1', category: 'orders', channel: 'email' })).toBe(false)
  })
})

describe('setPreference', () => {
  it('muted=true upserts the row', async () => {
    const c = mkClient({ rows: [{ category: 'orders', channel: '*', muted: true }] })
    const r = await repo.setPreference(c, { appId: 'a', tenantId: 't', userId: 'u1', category: 'orders', channel: '*', muted: true })
    expect(r.muted).toBe(true)
    expect(c.query.mock.calls[0][0]).toMatch(/INSERT INTO/)
  })
  it('muted=false deletes the row (opt-out absence semantics)', async () => {
    const c = mkClient()
    const r = await repo.setPreference(c, { appId: 'a', tenantId: 't', userId: 'u1', category: 'orders', channel: 'email', muted: false })
    expect(r).toEqual({ category: 'orders', channel: 'email', muted: false })
    expect(c.query.mock.calls[0][0]).toMatch(/DELETE FROM/)
  })
})

describe('unsubscribe tokens', () => {
  it('upsertToken returns the persisted token', async () => {
    const c = mkClient({ rows: [{ token: 'tok' }] })
    const t = await repo.upsertToken(c, { appId: 'a', tenantId: 't', userId: 'u1', token: 'tok' })
    expect(t).toBe('tok')
  })
  it('findByToken returns the row or null', async () => {
    const c = mkClient({ rows: [{ token: 'tok', app_id: 'a', tenant_id: 't', user_id: 'u1' }] })
    expect(await repo.findByToken(c, 'tok')).toMatchObject({ user_id: 'u1' })
    const c2 = mkClient({ rows: [] })
    expect(await repo.findByToken(c2, 'nope')).toBeNull()
  })
  it('muteByScope upserts a muted pref', async () => {
    const c = mkClient()
    await repo.muteByScope(c, { appId: 'a', tenantId: 't', userId: 'u1', category: 'marketing', channel: '*' })
    expect(c.query.mock.calls[0][0]).toMatch(/INSERT INTO/)
    expect(c.query.mock.calls[0][1]).toEqual(['a', 't', 'u1', 'marketing', '*'])
  })
})
