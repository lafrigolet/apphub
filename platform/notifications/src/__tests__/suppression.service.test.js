// suppression.service — gate + writer. NODE_ENV is forced to 'production' so
// the real DB path runs against a mocked pool; the test no-op (NODE_ENV='test')
// is verified separately.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const envRef = vi.hoisted(() => ({ NODE_ENV: 'production' }))
vi.mock('../lib/env.js', () => ({ env: envRef }))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { release, connect } = vi.hoisted(() => ({ release: vi.fn(), connect: vi.fn() }))
vi.mock('../lib/db.js', () => ({ pool: { connect } }))

const repo = vi.hoisted(() => ({ isSuppressed: vi.fn(), upsert: vi.fn() }))
vi.mock('../repositories/suppressions.repository.js', () => repo)

import * as svc from '../services/suppression.service.js'
import { logger } from '../lib/logger.js'

beforeEach(() => {
  vi.clearAllMocks()
  envRef.NODE_ENV = 'production'
  connect.mockResolvedValue({ release })
})

describe('normaliseRecipient', () => {
  it('lower-cases + trims email; trims phone only', () => {
    expect(svc.normaliseRecipient('email', '  A@X.COM ')).toBe('a@x.com')
    expect(svc.normaliseRecipient('sms', ' +34600 ')).toBe('+34600')
    expect(svc.normaliseRecipient('email', '')).toBe('')
  })
})

describe('isSuppressed', () => {
  it('returns the repo result, normalising the recipient', async () => {
    repo.isSuppressed.mockResolvedValue(true)
    expect(await svc.isSuppressed('email', 'A@X.com')).toBe(true)
    expect(repo.isSuppressed.mock.calls[0][1]).toEqual({ channel: 'email', recipient: 'a@x.com' })
    expect(release).toHaveBeenCalled()
  })
  it('no-op (false) under NODE_ENV=test without touching the DB', async () => {
    envRef.NODE_ENV = 'test'
    expect(await svc.isSuppressed('email', 'a@x')).toBe(false)
    expect(connect).not.toHaveBeenCalled()
  })
  it('false for empty recipient', async () => {
    expect(await svc.isSuppressed('email', '')).toBe(false)
    expect(connect).not.toHaveBeenCalled()
  })
  it('fails open (false) on a DB error', async () => {
    repo.isSuppressed.mockRejectedValue(new Error('down'))
    expect(await svc.isSuppressed('email', 'a@x')).toBe(false)
    expect(logger.warn).toHaveBeenCalled()
    expect(release).toHaveBeenCalled()
  })
})

describe('suppress', () => {
  it('normalises and upserts', async () => {
    repo.upsert.mockResolvedValue({ id: 's1' })
    const r = await svc.suppress({ channel: 'email', recipient: 'A@X', reason: 'bounce', detail: 'd' })
    expect(r).toEqual({ id: 's1' })
    expect(repo.upsert.mock.calls[0][1]).toMatchObject({ channel: 'email', recipient: 'a@x', reason: 'bounce' })
  })
  it('no-op for empty recipient', async () => {
    await svc.suppress({ channel: 'email', recipient: '', reason: 'manual' })
    expect(connect).not.toHaveBeenCalled()
  })
  it('swallows write errors (best-effort)', async () => {
    repo.upsert.mockRejectedValue(new Error('boom'))
    await expect(svc.suppress({ channel: 'sms', recipient: '+34', reason: 'opt_out' })).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalled()
    expect(release).toHaveBeenCalled()
  })
})
