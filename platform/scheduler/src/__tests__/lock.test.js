import { describe, it, expect, vi } from 'vitest'
import { tryAdvisoryLock, releaseAdvisoryLock } from '../lib/lock.js'

describe('tryAdvisoryLock', () => {
  it('returns true on success and false otherwise', async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ got: true }] })
        .mockResolvedValueOnce({ rows: [{ got: false }] }),
    }
    expect(await tryAdvisoryLock(client, 'job-a')).toBe(true)
    expect(await tryAdvisoryLock(client, 'job-a')).toBe(false)
  })

  it('escapes single quotes in the job name when building the literal', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ got: true }] }) }
    await tryAdvisoryLock(client, "weird'name")
    // the SQL emitted should contain the doubled quote, never an unescaped one.
    const sql = client.query.mock.calls[0][0]
    expect(sql).toMatch(/'weird''name'/)
  })
})

describe('releaseAdvisoryLock', () => {
  it('issues pg_advisory_unlock', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    await releaseAdvisoryLock(client, 'job-a')
    expect(client.query.mock.calls[0][0]).toMatch(/pg_advisory_unlock/)
  })
})
