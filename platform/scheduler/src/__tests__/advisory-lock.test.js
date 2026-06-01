// advisory-lock — exclusión mutua real entre runners concurrentes (P0).
// A diferencia de lock.test.js (que mockea got:true/false directamente),
// aquí montamos un "servidor de locks" con ESTADO compartido que imita la
// semántica de pg_try_advisory_lock: mientras una sesión tiene el lock de un
// job, otra sesión que lo pide recibe `false`. Esto prueba que dos runners
// simultáneos del mismo job → SOLO UNO ejecuta.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── servidor de locks con estado compartido entre "sesiones" ───────────
const lockServer = (() => {
  const held = new Map() // jobName → ownerId
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
          held.set(job, id); holds.add(job)
          return { rows: [{ got: true }] }
        }
        if (/pg_advisory_unlock/.test(sql)) {
          if (held.get(job) === id) { held.delete(job); holds.delete(job) }
          return { rows: [{ ok: true }] }
        }
        return { rows: [] }
      }),
      // release() = cierre de sesión: PG libera TODOS los advisory locks de la sesión.
      release: vi.fn(() => { for (const j of holds) held.delete(j); holds.clear() }),
    }
  }
  return { makeClient, held, reset: () => { held.clear(); nextId = 1 } }
})()

vi.mock('../lib/env.js', () => ({ env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL_SCHEDULER: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' } }))

const { poolQueryMock, poolConnectMock } = vi.hoisted(() => ({
  poolQueryMock: vi.fn(),
  poolConnectMock: vi.fn(),
}))
vi.mock('../lib/db.js', () => ({ pool: { query: poolQueryMock, connect: poolConnectMock } }))
vi.mock('../lib/redis.js', () => ({ redis: { publish: vi.fn() }, publish: vi.fn() }))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockImplementation(function () { return this }) },
}))

import { tryAdvisoryLock, releaseAdvisoryLock } from '../lib/lock.js'
import { jobRunner } from '../lib/job-runner.js'

const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  vi.clearAllMocks()
  lockServer.reset()
  // pool.connect siempre entrega una nueva "sesión" del servidor de locks.
  poolConnectMock.mockImplementation(async () => lockServer.makeClient())
  // pool.query atiende la tabla runs (INSERT running → id, UPDATEs).
  poolQueryMock.mockResolvedValue({ rows: [{ id: 'run-1' }] })
})

describe('lock.js — exclusión mutua entre sesiones (estado compartido)', () => {
  it('mientras la sesión A tiene el lock, B no lo obtiene; tras liberar, B sí', async () => {
    const a = lockServer.makeClient()
    const b = lockServer.makeClient()
    expect(await tryAdvisoryLock(a, 'reminders')).toBe(true)
    expect(await tryAdvisoryLock(b, 'reminders')).toBe(false)   // A lo tiene
    await releaseAdvisoryLock(a, 'reminders')
    expect(await tryAdvisoryLock(b, 'reminders')).toBe(true)    // recuperado
  })

  it('locks de jobs DISTINTOS no colisionan', async () => {
    const a = lockServer.makeClient()
    const b = lockServer.makeClient()
    expect(await tryAdvisoryLock(a, 'job-a')).toBe(true)
    expect(await tryAdvisoryLock(b, 'job-b')).toBe(true)        // distinto job → OK
  })
})

describe('jobRunner — dos runners simultáneos del mismo job: SOLO uno ejecuta', () => {
  it('el segundo runner ve el lock tomado y se salta (skipped: locked)', async () => {
    let release
    const gate = new Promise((r) => { release = r })
    const runA = vi.fn(async () => { await gate; return { rowsAffected: 1 } })
    const runB = vi.fn(async () => ({ rowsAffected: 1 }))

    const pA = jobRunner({ name: 'nightly' }, runA) // adquiere y se bloquea en gate
    await flush()                                    // deja que A tome el lock
    const resB = await jobRunner({ name: 'nightly' }, runB) // B intenta mientras A lo tiene

    expect(resB).toEqual({ skipped: 'locked' })
    expect(runB).not.toHaveBeenCalled()

    release()
    const resA = await pA
    expect(runA).toHaveBeenCalledTimes(1)
    expect(resA).toMatchObject({ rowsAffected: 1 })
  })

  it('tras completar A y soltar el lock, un tercer runner puede ejecutar', async () => {
    await jobRunner({ name: 'nightly' }, vi.fn(async () => ({ rowsAffected: 1 })))
    const runC = vi.fn(async () => ({ rowsAffected: 2 }))
    const resC = await jobRunner({ name: 'nightly' }, runC)
    expect(runC).toHaveBeenCalledTimes(1)
    expect(resC).toMatchObject({ rowsAffected: 2 })
    expect(lockServer.held.size).toBe(0) // lock liberado al final
  })
})
