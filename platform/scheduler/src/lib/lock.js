// Postgres advisory-lock helpers — used so concurrent runs of the same cron
// job (manual trigger + cron tick coinciding, or a slow job overlapping its
// next firing) skip silently instead of stomping on each other.

function lockKey(jobName) {
  // Deterministic 64-bit hash from the job name. pg_try_advisory_lock(bigint)
  // takes a single 64-bit key; we use hashtext() (32-bit) shifted into the
  // high half so two different jobs don't collide.
  return `('x' || md5(${pgLiteral(jobName)}))::bit(64)::bigint`
}

function pgLiteral(s) {
  return `'${String(s).replace(/'/g, "''")}'`
}

export async function tryAdvisoryLock(client, jobName) {
  const { rows } = await client.query(`SELECT pg_try_advisory_lock(${lockKey(jobName)}) AS got`)
  return rows[0].got === true
}

export async function releaseAdvisoryLock(client, jobName) {
  await client.query(`SELECT pg_advisory_unlock(${lockKey(jobName)})`)
}
