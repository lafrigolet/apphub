import { pool } from './db.js'
import { redis, publish } from './redis.js'
import { logger as rootLogger } from './logger.js'
import { tryAdvisoryLock, releaseAdvisoryLock } from './lock.js'
import { env } from './env.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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
    // Retry with exponential backoff. JOB_MAX_RETRIES=0 (default) preserves the
    // original single-attempt behaviour. Jobs are required to be idempotent
    // (UPDATE-RETURNING sentinels, natural dedup keys, …) so re-running a
    // partially-applied tick is safe.
    const maxAttempts = (env.JOB_MAX_RETRIES ?? 0) + 1
    const backoffBase = env.JOB_RETRY_BACKOFF_MS ?? 500
    let lastErr
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await runFn({ db: pool, redis, publish, logger: log })
        const ms = Date.now() - start
        const meta_ = { durationMs: ms, ...(result?.metadata ?? {}) }
        if (attempt > 1) meta_.attempts = attempt
        await recordSuccess(runId, result?.rowsAffected ?? null, meta_)
        log.info({ ms, rowsAffected: result?.rowsAffected ?? null, attempt }, 'job completed')
        return result ?? {}
      } catch (err) {
        lastErr = err
        if (attempt < maxAttempts) {
          const delay = backoffBase * 2 ** (attempt - 1)
          log.warn({ err, attempt, delay }, 'job attempt failed, retrying')
          await sleep(delay)
          continue
        }
      }
    }
    // All attempts exhausted.
    await recordError(runId, lastErr, maxAttempts)
    log.error({ err: lastErr, attempts: maxAttempts }, 'job failed')
    // Dead-man / alerting signal — the notifications module turns this into an
    // email/Slack ping to ops. Best-effort: if the publish itself fails we
    // swallow it so the runner still returns cleanly (the error is already in
    // the runs table).
    try {
      await publish({
        type: 'scheduler.job.failed',
        payload: { jobName: meta.name, runId, attempts: maxAttempts, error: lastErr.message },
      })
    } catch (pubErr) {
      log.warn({ err: pubErr }, 'failed to publish scheduler.job.failed')
    }
    // Don't rethrow — a failed cron tick shouldn't crash the process.
    return { error: lastErr.message }
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

async function recordError(runId, err, attempts) {
  await pool.query(
    `UPDATE platform_scheduler.runs
     SET finished_at = now(), status = 'error', error = $2,
         metadata = metadata || $3::jsonb
     WHERE id = $1`,
    [runId, (err.stack || String(err)).slice(0, 8000), JSON.stringify({ attempts })],
  )
}

async function recordSkippedLocked(jobName) {
  await pool.query(
    `INSERT INTO platform_scheduler.runs (job_name, status, finished_at)
     VALUES ($1, 'skipped_locked', now())`,
    [jobName],
  )
}
