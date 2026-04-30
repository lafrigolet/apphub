import { pool } from './db.js'
import { redis, publish } from './redis.js'
import { logger as rootLogger } from './logger.js'
import { tryAdvisoryLock, releaseAdvisoryLock } from './lock.js'

// Wraps job execution: advisory-lock around `run()`, audit row in
// platform_scheduler.runs, and structured error logging. Each job's `run`
// receives the shared resources so it doesn't have to know about scheduler
// plumbing.
export async function jobRunner(meta, runFn) {
  const log = rootLogger.child({ job: meta.name })
  const lockClient = await pool.connect()
  let runId
  try {
    const got = await tryAdvisoryLock(lockClient, meta.name)
    if (!got) {
      log.debug('skipped: another instance is running')
      await recordSkippedLocked(meta.name)
      return { skipped: 'locked' }
    }

    runId = await recordStart(meta.name)
    const start = Date.now()
    try {
      const result = await runFn({ db: pool, redis, publish, logger: log })
      const ms = Date.now() - start
      await recordSuccess(runId, result?.rowsAffected ?? null, { durationMs: ms, ...(result?.metadata ?? {}) })
      log.info({ ms, rowsAffected: result?.rowsAffected ?? null }, 'job completed')
      return result ?? {}
    } catch (err) {
      await recordError(runId, err)
      log.error({ err }, 'job failed')
      // Don't rethrow — a failed cron tick shouldn't crash the process.
      return { error: err.message }
    }
  } finally {
    try { await releaseAdvisoryLock(lockClient, meta.name) } catch (err) { log.warn({ err }, 'unlock error') }
    lockClient.release()
  }
}

async function recordStart(jobName) {
  const { rows } = await pool.query(
    `INSERT INTO platform_scheduler.runs (job_name, status) VALUES ($1, 'running') RETURNING id`,
    [jobName],
  )
  return rows[0].id
}

async function recordSuccess(runId, rowsAffected, metadata) {
  await pool.query(
    `UPDATE platform_scheduler.runs
     SET finished_at = now(), status = 'success', rows_affected = $2, metadata = $3
     WHERE id = $1`,
    [runId, rowsAffected, metadata],
  )
}

async function recordError(runId, err) {
  await pool.query(
    `UPDATE platform_scheduler.runs
     SET finished_at = now(), status = 'error', error = $2
     WHERE id = $1`,
    [runId, (err.stack || String(err)).slice(0, 8000)],
  )
}

async function recordSkippedLocked(jobName) {
  await pool.query(
    `INSERT INTO platform_scheduler.runs (job_name, status, finished_at)
     VALUES ($1, 'skipped_locked', now())`,
    [jobName],
  )
}
