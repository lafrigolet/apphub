import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as repo from '../repositories/suppressions.repository.js'

function mkClient(result = { rows: [], rowCount: 0 }) {
  return { query: vi.fn().mockResolvedValue(result) }
}

beforeEach(() => vi.clearAllMocks())

describe('upsert', () => {
  it('inserts/updates and returns the row', async () => {
    const c = mkClient({ rows: [{ id: 's1', channel: 'email', recipient: 'a@x', reason: 'bounce' }] })
    const r = await repo.upsert(c, { channel: 'email', recipient: 'a@x', reason: 'bounce', detail: 'd' })
    expect(r.id).toBe('s1')
    expect(c.query.mock.calls[0][0]).toMatch(/ON CONFLICT/)
    expect(c.query.mock.calls[0][1]).toEqual(['email', 'a@x', 'bounce', 'd'])
  })
  it('truncates long detail and tolerates null', async () => {
    const c = mkClient({ rows: [{ id: 's1' }] })
    await repo.upsert(c, { channel: 'sms', recipient: '+34', reason: 'opt_out', detail: 'x'.repeat(5000) })
    expect(c.query.mock.calls[0][1][3].length).toBe(2000)
    await repo.upsert(c, { channel: 'sms', recipient: '+34', reason: 'manual' })
    expect(c.query.mock.calls[1][1][3]).toBeNull()
  })
})

describe('isSuppressed', () => {
  it('true when a row exists', async () => {
    const c = mkClient({ rows: [{ '?column?': 1 }] })
    expect(await repo.isSuppressed(c, { channel: 'email', recipient: 'a@x' })).toBe(true)
  })
  it('false when none', async () => {
    const c = mkClient({ rows: [] })
    expect(await repo.isSuppressed(c, { channel: 'email', recipient: 'a@x' })).toBe(false)
  })
})

describe('list', () => {
  it('without filter', async () => {
    const c = mkClient({ rows: [{ id: 's1' }] })
    const r = await repo.list(c, {})
    expect(r).toHaveLength(1)
    expect(c.query.mock.calls[0][0]).not.toMatch(/WHERE/)
    expect(c.query.mock.calls[0][1]).toEqual([100, 0])
  })
  it('with channel filter', async () => {
    const c = mkClient({ rows: [] })
    await repo.list(c, { channel: 'sms', limit: 10, offset: 5 })
    expect(c.query.mock.calls[0][0]).toMatch(/WHERE channel = \$1/)
    expect(c.query.mock.calls[0][1]).toEqual(['sms', 10, 5])
  })
})

describe('remove', () => {
  it('true when a row was deleted', async () => {
    const c = mkClient({ rowCount: 1 })
    expect(await repo.remove(c, { channel: 'email', recipient: 'a@x' })).toBe(true)
  })
  it('false when nothing matched', async () => {
    const c = mkClient({ rowCount: 0 })
    expect(await repo.remove(c, { channel: 'email', recipient: 'a@x' })).toBe(false)
  })
})
