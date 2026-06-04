// job-runner — wrapper canónico para cada job del scheduler.
// Contrato:
//   - Antes del run: tryAdvisoryLock; si NO lo obtiene → recordSkippedLocked + return {skipped: 'locked'}.
//   - Si lo obtiene → INSERT runs(status='running') → ejecuta run() → UPDATE success/error.
//   - Job exitoso: UPDATE status='success' + rows_affected + metadata.durationMs.
//   - Job que lanza: UPDATE status='error' + error stack (truncado a 8000), NO propaga (return {error: msg}).
//   - finally: SIEMPRE releaseAdvisoryLock + client.release (incluso si todo falla).
//   - jobs reciben { db, redis, publish, logger } como parámetros.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL_SCHEDULER: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost',
    JOB_MAX_RETRIES: 0, JOB_RETRY_BACKOFF_MS: 0,
  },
}))
const { poolQueryMock, poolConnectMock, lockClient, redisMock, publishMock } = vi.hoisted(() => {
  const client = { query: vi.fn().mockResolvedValue({ rows: [{ got: true }] }), release: vi.fn() }
  return {
    poolQueryMock: vi.fn(),
    poolConnectMock: vi.fn().mockResolvedValue(client),
    lockClient: client,
    redisMock: { publish: vi.fn() },
    publishMock: vi.fn(),
  }
})
vi.mock('../lib/db.js', () => ({
  pool: { query: poolQueryMock, connect: poolConnectMock },
}))
vi.mock('../lib/redis.js', () => ({ redis: redisMock, publish: publishMock }))
vi.mock('../lib/logger.js', () => ({
  logger: {
    info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
    child: vi.fn().mockImplementation(function () { return this }),
  },
}))

import { jobRunner } from '../lib/job-runner.js'
import { env } from '../lib/env.js'

beforeEach(() => {
  vi.clearAllMocks()
  // reset retry/backoff to defaults; individual tests override.
  env.JOB_MAX_RETRIES = 0
  env.JOB_RETRY_BACKOFF_MS = 0
  // default: lock granted, INSERT/UPDATE success
  lockClient.query.mockReset()
  lockClient.query.mockResolvedValue({ rows: [{ got: true }] })
  lockClient.release.mockReset()
  poolConnectMock.mockResolvedValue(lockClient)
  poolQueryMock.mockResolvedValue({ rows: [{ id: 'run-1' }] })
})

// ── Lock contention ──────────────────────────────────────────────────

describe('lock contention', () => {
  it('no obtiene el lock → recordSkippedLocked + return {skipped: "locked"}; NO ejecuta run', async () => {
    lockClient.query.mockResolvedValueOnce({ rows: [{ got: false }] })
    const runFn = vi.fn()
    const r = await jobRunner({ name: 'job-x' }, runFn)
    expect(r).toEqual({ skipped: 'locked' })
    expect(runFn).not.toHaveBeenCalled()
    expect(poolQueryMock).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO platform_scheduler\.runs.*skipped_locked/s),
      ['job-x'],
    )
  })

  it('lock obtenido → ejecuta run + INSERT runs(running)', async () => {
    const runFn = vi.fn().mockResolvedValue({ rowsAffected: 3 })
    await jobRunner({ name: 'job-x' }, runFn)
    expect(runFn).toHaveBeenCalled()
    expect(poolQueryMock).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO platform_scheduler\.runs.*running/s),
      ['job-x'],
    )
  })
})

// ── run() success ────────────────────────────────────────────────────

describe('successful run', () => {
  it('UPDATE status=success + rowsAffected + metadata.durationMs', async () => {
    poolQueryMock
      .mockResolvedValueOnce({ rows: [{ id: 'run-42' }] })  // INSERT
      .mockResolvedValueOnce({ rows: [] })                    // UPDATE success

    const runFn = vi.fn().mockResolvedValue({ rowsAffected: 7, metadata: { extra: 'foo' } })
    const r = await jobRunner({ name: 'job-x' }, runFn)
    expect(r.rowsAffected).toBe(7)

    // 2ª call = UPDATE success
    const updateCall = poolQueryMock.mock.calls[1]
    expect(updateCall[0]).toMatch(/UPDATE platform_scheduler\.runs.*status = 'success'/s)
    const [runId, rowsAffected, metadata] = updateCall[1]
    expect(runId).toBe('run-42')
    expect(rowsAffected).toBe(7)
    expect(metadata).toMatchObject({ extra: 'foo', durationMs: expect.any(Number) })
  })

  it('runFn sin resultado → rowsAffected=null en UPDATE', async () => {
    poolQueryMock
      .mockResolvedValueOnce({ rows: [{ id: 'run-1' }] })
      .mockResolvedValueOnce({ rows: [] })
    const runFn = vi.fn().mockResolvedValue(undefined)
    const r = await jobRunner({ name: 'job-x' }, runFn)
    expect(r).toEqual({})
    expect(poolQueryMock.mock.calls[1][1][1]).toBe(null)
  })

  it('runFn recibe {db, redis, publish, logger}', async () => {
    const runFn = vi.fn().mockResolvedValue({})
    await jobRunner({ name: 'job-x' }, runFn)
    expect(runFn).toHaveBeenCalledWith(expect.objectContaining({
      db: expect.any(Object), redis: redisMock, publish: publishMock, logger: expect.any(Object),
    }))
  })
})

// ── run() error: capturado, no propaga ───────────────────────────────

describe('runFn throws', () => {
  it('UPDATE status=error + error message; NO propaga', async () => {
    poolQueryMock
      .mockResolvedValueOnce({ rows: [{ id: 'run-1' }] })
      .mockResolvedValueOnce({ rows: [] })  // UPDATE error
    const runFn = vi.fn().mockRejectedValue(new Error('DB down'))
    const r = await jobRunner({ name: 'job-x' }, runFn)
    expect(r).toEqual({ error: 'DB down' })

    const updateCall = poolQueryMock.mock.calls[1]
    expect(updateCall[0]).toMatch(/UPDATE platform_scheduler\.runs.*status = 'error'/s)
    expect(updateCall[1][1]).toContain('DB down')
  })

  it('error stack se trunca a 8000 chars', async () => {
    poolQueryMock
      .mockResolvedValueOnce({ rows: [{ id: 'run-1' }] })
      .mockResolvedValueOnce({ rows: [] })
    const err = new Error('boom')
    err.stack = 'x'.repeat(20000)
    const runFn = vi.fn().mockRejectedValue(err)
    await jobRunner({ name: 'job-x' }, runFn)
    expect(poolQueryMock.mock.calls[1][1][1].length).toBe(8000)
  })
})

// ── finally: always release ──────────────────────────────────────────

describe('cleanup', () => {
  it('libera lock + client incluso si runFn falla', async () => {
    const runFn = vi.fn().mockRejectedValue(new Error('boom'))
    await jobRunner({ name: 'job-x' }, runFn)
    // pg_advisory_unlock se llama en el cliente del lock (2ª call: 1=lock, 2=unlock)
    const unlockCall = lockClient.query.mock.calls.find(([sql]) => /pg_advisory_unlock/.test(sql))
    expect(unlockCall).toBeTruthy()
    expect(lockClient.release).toHaveBeenCalled()
  })

  it('libera client si releaseAdvisoryLock falla (warn pero no rethrow)', async () => {
    lockClient.query
      .mockResolvedValueOnce({ rows: [{ got: true }] })  // lock acquire
      .mockRejectedValueOnce(new Error('unlock failed'))  // unlock fails
    const runFn = vi.fn().mockResolvedValue({})
    await jobRunner({ name: 'job-x' }, runFn)
    expect(lockClient.release).toHaveBeenCalled()         // SIEMPRE
  })
})

// ── Block A: retry with backoff + dead-man event ─────────────────────

describe('retry with backoff', () => {
  it('reintenta JOB_MAX_RETRIES veces antes de éxito y registra attempts', async () => {
    env.JOB_MAX_RETRIES = 2
    env.JOB_RETRY_BACKOFF_MS = 0
    poolQueryMock
      .mockResolvedValueOnce({ rows: [{ id: 'run-1' }] })  // INSERT
      .mockResolvedValueOnce({ rows: [] })                  // UPDATE success
    const runFn = vi.fn()
      .mockRejectedValueOnce(new Error('flaky'))
      .mockResolvedValueOnce({ rowsAffected: 1 })
    const r = await jobRunner({ name: 'job-x' }, runFn)
    expect(r.rowsAffected).toBe(1)
    expect(runFn).toHaveBeenCalledTimes(2)
    const meta = poolQueryMock.mock.calls[1][1][2]
    expect(meta.attempts).toBe(2)
  })

  it('agota reintentos → status=error + publica scheduler.job.failed', async () => {
    env.JOB_MAX_RETRIES = 1
    env.JOB_RETRY_BACKOFF_MS = 0
    poolQueryMock
      .mockResolvedValueOnce({ rows: [{ id: 'run-9' }] })   // INSERT
      .mockResolvedValueOnce({ rows: [] })                   // UPDATE error
    const runFn = vi.fn().mockRejectedValue(new Error('always down'))
    const r = await jobRunner({ name: 'job-y' }, runFn)
    expect(r).toEqual({ error: 'always down' })
    expect(runFn).toHaveBeenCalledTimes(2)  // 1 + 1 retry
    const updateCall = poolQueryMock.mock.calls[1]
    expect(updateCall[0]).toMatch(/status = 'error'/)
    expect(updateCall[1][2]).toBe(JSON.stringify({ attempts: 2 }))
    expect(publishMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'scheduler.job.failed',
      payload: expect.objectContaining({ jobName: 'job-y', attempts: 2, error: 'always down' }),
    }))
  })

  it('si la publicación del dead-man falla, el runner igual retorna {error}', async () => {
    env.JOB_MAX_RETRIES = 0
    poolQueryMock
      .mockResolvedValueOnce({ rows: [{ id: 'run-3' }] })
      .mockResolvedValueOnce({ rows: [] })
    publishMock.mockRejectedValueOnce(new Error('redis down'))
    const runFn = vi.fn().mockRejectedValue(new Error('boom'))
    const r = await jobRunner({ name: 'job-z' }, runFn)
    expect(r).toEqual({ error: 'boom' })
  })
})
