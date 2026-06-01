// missed-tick-recovery — qué pasa si un runner se cayó a mitad de un tick (P2).
// Los advisory locks son SESSION-SCOPED: si el runner muere, su conexión se
// cierra y Postgres libera automáticamente el lock. El siguiente tick lo
// adquiere y ejecuta — no queda "atascado". Además, un job que FALLA en un
// tick suelta el lock en finally, así que el tick siguiente corre normal.
// (El scheduler no encola ticks perdidos: simplemente corre en el próximo.)
import { describe, it, expect, vi, beforeEach } from 'vitest'

const lockServer = (() => {
  const held = new Map()
  let nextId = 1
  const jobOf = (sql) => sql.match(/md5\('([^']*)'\)/)?.[1]
  function makeClient() {
    const id = nextId++
    const holds = new Set()
    return {
      id,
      query: vi.fn(async (sql) => {
        const job = jobOf(sql)
        if (/pg_try_advisory_lock/.test(sql)) {
          if (held.has(job) && held.get(job) !== id) return { rows: [{ got: false }] }
          held.set(job, id); holds.add(job); return { rows: [{ got: true }] }
        }
        if (/pg_advisory_unlock/.test(sql)) {
          if (held.get(job) === id) { held.delete(job); holds.delete(job) }
          return { rows: [{ ok: true }] }
        }
        return { rows: [] }
      }),
      // cierre de sesión (incl. crash) → PG libera todos sus advisory locks.
      release: vi.fn(() => { for (const j of holds) held.delete(j); holds.clear() }),
    }
  }
  return { makeClient, held, reset: () => { held.clear(); nextId = 1 } }
})()

vi.mock('../lib/env.js', () => ({ env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL_SCHEDULER: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' } }))
const { poolQueryMock, poolConnectMock } = vi.hoisted(() => ({ poolQueryMock: vi.fn(), poolConnectMock: vi.fn() }))
vi.mock('../lib/db.js', () => ({ pool: { query: poolQueryMock, connect: poolConnectMock } }))
vi.mock('../lib/redis.js', () => ({ redis: { publish: vi.fn() }, publish: vi.fn() }))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockImplementation(function () { return this }) },
}))

import { tryAdvisoryLock } from '../lib/lock.js'
import { jobRunner } from '../lib/job-runner.js'

beforeEach(() => {
  vi.clearAllMocks()
  lockServer.reset()
  poolConnectMock.mockImplementation(async () => lockServer.makeClient())
  poolQueryMock.mockResolvedValue({ rows: [{ id: 'run-1' }] })
})

describe('recuperación tras runner caído', () => {
  it('crash de la sesión que tenía el lock → PG lo libera → el siguiente tick lo adquiere', async () => {
    // Tick 1: el runner adquiere el lock y "se cae" (cierra la sesión sin unlock explícito).
    const crashed = lockServer.makeClient()
    expect(await tryAdvisoryLock(crashed, 'reminders')).toBe(true)
    expect(lockServer.held.has('reminders')).toBe(true)
    crashed.release() // muerte del proceso → cierre de conexión
    expect(lockServer.held.has('reminders')).toBe(false) // lock recuperado

    // Tick 2: un runner fresco adquiere y ejecuta sin quedar bloqueado.
    const run = vi.fn(async () => ({ rowsAffected: 5 }))
    const res = await jobRunner({ name: 'reminders' }, run)
    expect(run).toHaveBeenCalledTimes(1)
    expect(res).toMatchObject({ rowsAffected: 5 })
  })

  it('un tick que FALLA suelta el lock (finally) → el tick siguiente corre normal', async () => {
    const r1 = await jobRunner({ name: 'reminders' }, vi.fn(async () => { throw new Error('DB down a mitad') }))
    expect(r1).toEqual({ error: 'DB down a mitad' })
    expect(lockServer.held.size).toBe(0) // lock liberado pese al error

    const run2 = vi.fn(async () => ({ rowsAffected: 9 }))
    const r2 = await jobRunner({ name: 'reminders' }, run2)
    expect(run2).toHaveBeenCalledTimes(1) // NO se salta: el lock estaba libre
    expect(r2).toMatchObject({ rowsAffected: 9 })
  })

  it('los ticks perdidos NO se encolan: cada jobRunner es una corrida independiente', async () => {
    // Tres ticks secuenciales → tres ejecuciones, ninguna saltada por lock residual.
    const run = vi.fn(async () => ({ rowsAffected: 1 }))
    await jobRunner({ name: 'purge' }, run)
    await jobRunner({ name: 'purge' }, run)
    await jobRunner({ name: 'purge' }, run)
    expect(run).toHaveBeenCalledTimes(3)
    expect(lockServer.held.size).toBe(0)
  })
})
