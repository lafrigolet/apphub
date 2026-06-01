// admin.routes — endpoints de console para listar jobs, ver runs y
// ejecutar un job on-demand. Las opciones (jobs, jobRunner, pool) se inyectan
// al registrar el plugin.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'

import { adminRoutes } from '../routes/admin.routes.js'

const jobs = [
  { meta: { name: 'job-a', description: 'A', cron: '* * * * *' }, run: vi.fn(), enabled: true },
  { meta: { name: 'job-b', description: 'B', cron: '0 * * * *' }, run: vi.fn(), enabled: false },
]

let pool, jobRunner, app

async function buildApp() {
  const a = Fastify({ logger: false })
  a.setValidatorCompiler(() => () => ({ value: true }))
  a.setSerializerCompiler(() => (d) => JSON.stringify(d))
  await a.register(adminRoutes, { jobs, jobRunner, pool })
  await a.ready()
  return a
}

beforeEach(async () => {
  vi.clearAllMocks()
  pool = { query: vi.fn().mockResolvedValue({ rows: [] }) }
  jobRunner = vi.fn().mockResolvedValue({ ok: true, rowsAffected: 3 })
  app = await buildApp()
})
afterEach(async () => { await app.close() })

describe('GET /v1/scheduler/jobs', () => {
  it('lista los jobs con name/description/cron/enabled', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/scheduler/jobs' })
    expect(res.statusCode).toBe(200)
    const data = res.json()
    expect(data).toEqual([
      { name: 'job-a', description: 'A', cron: '* * * * *', enabled: true },
      { name: 'job-b', description: 'B', cron: '0 * * * *', enabled: false },
    ])
  })
})

describe('GET /v1/scheduler/runs', () => {
  it('sin jobName → sin WHERE, limit default 100', async () => {
    pool.query.mockResolvedValue({ rows: [{ id: 'r1' }] })
    const res = await app.inject({ method: 'GET', url: '/v1/scheduler/runs' })
    expect(res.statusCode).toBe(200)
    const [sql, args] = pool.query.mock.calls[0]
    expect(sql).not.toMatch(/WHERE/)
    expect(args).toEqual([100])
    expect(res.json()).toEqual([{ id: 'r1' }])
  })

  it('con jobName + limit → WHERE job_name=$1', async () => {
    pool.query.mockResolvedValue({ rows: [] })
    const res = await app.inject({ method: 'GET', url: '/v1/scheduler/runs?jobName=job-a&limit=10' })
    expect(res.statusCode).toBe(200)
    const [sql, args] = pool.query.mock.calls[0]
    expect(sql).toMatch(/WHERE job_name = \$1/)
    expect(args).toEqual(['job-a', 10])
  })
})

describe('POST /v1/scheduler/jobs/:name/run', () => {
  it('job desconocido → 404', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/scheduler/jobs/ghost/run' })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('NOT_FOUND')
    expect(jobRunner).not.toHaveBeenCalled()
  })

  it('job válido → ejecuta jobRunner(meta, run) y devuelve el resultado', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/scheduler/jobs/job-a/run' })
    expect(res.statusCode).toBe(200)
    expect(jobRunner).toHaveBeenCalledWith(jobs[0].meta, jobs[0].run)
    expect(res.json()).toEqual({ ok: true, rowsAffected: 3 })
  })
})
