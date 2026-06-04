// Webhook-event dedup store. Not tenant-scoped: events arrive before we know
// the tenant. recordReceived returns false when the event id already exists
// (Stripe retry / replay), so the handler can drop duplicates.

export async function recordReceived(client, stripeEventId, type) {
  const { rowCount } = await client.query(
    `INSERT INTO platform_payments.webhook_events (stripe_event_id, type)
     VALUES ($1, $2)
     ON CONFLICT (stripe_event_id) DO NOTHING`,
    [stripeEventId, type],
  )
  return rowCount === 1
}

export async function markProcessed(client, stripeEventId) {
  await client.query(
    `UPDATE platform_payments.webhook_events
        SET status = 'processed', processed_at = now()
      WHERE stripe_event_id = $1`,
    [stripeEventId],
  )
}

export async function markFailed(client, stripeEventId, error) {
  await client.query(
    `UPDATE platform_payments.webhook_events
        SET status = 'failed', error = $2, processed_at = now()
      WHERE stripe_event_id = $1`,
    [stripeEventId, String(error).slice(0, 2000)],
  )
}
