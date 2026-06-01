// push-devices.repository — registro de dispositivos push por usuario.
// Token único global (ON CONFLICT (token)); valida proyección, params y
// el booleano de las operaciones de borrado.
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/push-devices.repository.js'

function mockClient({ rows = [], rowCount = 0 } = {}) {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount }) }
}

describe('upsertByToken', () => {
  it('ON CONFLICT (token) reasigna el device; label COALESCE', async () => {
    const c = mockClient({ rows: [{ id: 'p1' }] })
    const r = await repo.upsertByToken(c, {
      appId: 'a', tenantId: 't', userId: 'u', platform: 'ios', token: 'tok', label: 'iPhone',
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/ON CONFLICT \(token\) DO UPDATE/)
    expect(sql).toMatch(/label = COALESCE\(EXCLUDED\.label/)
    expect(params).toEqual(['a', 't', 'u', 'ios', 'tok', 'iPhone'])
    expect(r).toEqual({ id: 'p1' })
  })

  it('label ausente → null', async () => {
    const c = mockClient({ rows: [{}] })
    await repo.upsertByToken(c, { appId: 'a', tenantId: 't', userId: 'u', platform: 'android', token: 'tok' })
    expect(c.query.mock.calls[0][1][5]).toBeNull()
  })
})

describe('listByUser / tokensForUser', () => {
  it('listByUser ordena por last_seen_at DESC', async () => {
    const c = mockClient({ rows: [{ id: 'p1' }] })
    expect(await repo.listByUser(c, 'u')).toEqual([{ id: 'p1' }])
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/ORDER BY last_seen_at DESC/)
    expect(params).toEqual(['u'])
  })

  it('tokensForUser proyecta token + platform', async () => {
    const c = mockClient({ rows: [{ token: 't', platform: 'ios' }] })
    await repo.tokensForUser(c, 'u')
    expect(c.query.mock.calls[0][0]).toMatch(/SELECT token, platform/)
  })
})

describe('findById', () => {
  it('null sin row', async () => {
    expect(await repo.findById(mockClient({ rows: [] }), 'x')).toBeNull()
  })
  it('row si existe', async () => {
    expect(await repo.findById(mockClient({ rows: [{ id: 'p1' }] }), 'p1')).toEqual({ id: 'p1' })
  })
})

describe('deleteById / deleteByToken', () => {
  it('deleteById → true cuando rowCount>0', async () => {
    expect(await repo.deleteById(mockClient({ rowCount: 1 }), 'p1')).toBe(true)
  })
  it('deleteById → false cuando rowCount=0', async () => {
    expect(await repo.deleteById(mockClient({ rowCount: 0 }), 'p1')).toBe(false)
  })
  it('deleteByToken → true/false según rowCount', async () => {
    expect(await repo.deleteByToken(mockClient({ rowCount: 1 }), 'tok')).toBe(true)
    expect(await repo.deleteByToken(mockClient({ rowCount: 0 }), 'tok')).toBe(false)
  })
})
