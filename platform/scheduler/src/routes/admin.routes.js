import { z } from 'zod'

// Admin endpoints — used by console for "run job now" buttons and
// to inspect recent runs. Protected by appGuard + requireRole('staff') below.
export async function adminRoutes(fastify, { jobs, jobRunner, pool }) {
  const byName = new Map(jobs.map((j) => [j.meta.name, j]))

  fastify.get('/v1/scheduler/jobs', { config: { roles: ['staff', 'super_admin'] } }, async () => {
    return jobs.map((j) => ({
      name:        j.meta.name,
      description: j.meta.description,
      cron:        j.meta.cron,
      enabled:     j.enabled,
    }))
  })

  fastify.get('/v1/scheduler/runs', { config: { roles: ['staff', 'super_admin'] } }, async (req) => {
    const params = z.object({
      jobName: z.string().optional(),
      limit:   z.coerce.number().int().min(1).max(500).default(100),
    }).parse(req.query)

    const filters = []
    const args    = []
    if (params.jobName) { filters.push(`job_name = $${args.length + 1}`); args.push(params.jobName) }
    args.push(params.limit)
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
    const { rows } = await pool.query(
      `SELECT id, job_name, started_at, finished_at, status, rows_affected, error, metadata
       FROM platform_scheduler.runs
       ${where}
       ORDER BY started_at DESC
       LIMIT $${args.length}`,
      args,
    )
    return rows
  })

  fastify.post('/v1/scheduler/jobs/:name/run', { config: { roles: ['staff', 'super_admin'] } }, async (req, reply) => {
    const job = byName.get(req.params.name)
    if (!job) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'job not found' } })
    const result = await jobRunner(job.meta, job.run)
    return result
  })
}
