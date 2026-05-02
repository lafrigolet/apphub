// Daily flush of buffered notification digests. The notifications module
// owns the actual queue + composer; we just kick it on schedule by
// publishing an internal event the consumer is subscribed to. Single-runner
// scheduler (replicas=1) makes a separate idempotency lock unnecessary.

export const meta = {
  name:        'notification-digest',
  // 09:00 UTC daily. Adjust per timezone of the typical recipient when the
  // platform serves a single region; for multi-tz tenants the digest_mode
  // hook should grow per-tenant cadence (deferred).
  cron:        '0 9 * * *',
  description: 'Flush per-user notification digest queues into composed emails',
}

export async function run({ publish, logger }) {
  await publish({ type: 'notifications.digest.flush', payload: {} })
  logger.info('digest flush event published')
  return { rowsAffected: 0 }
}
