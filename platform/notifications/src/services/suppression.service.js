// Suppression gate + writer for the bounce/complaint list.
//
// Consulted by the email sender before each send (recommendation #5): a hard
// bounce or spam complaint must stop future sends to that address or domain
// reputation suffers. Populated by the Resend webhook and by staff.
//
// Mirrors send-log.service.js conventions: opens its own short-lived
// connection, NEVER propagates errors (a suppression-store hiccup must not
// swallow a send — fail OPEN on read), and is a no-op under NODE_ENV='test'
// (unit suites mock providers, not the DB).
import { env } from '../lib/env.js'
import { pool } from '../lib/db.js'
import { logger } from '../lib/logger.js'
import * as repo from '../repositories/suppressions.repository.js'

// Normalise a recipient for comparison: email → lower-cased + trimmed; phone →
// trimmed. Keeps the table key stable across casing differences.
export function normaliseRecipient(channel, recipient) {
  if (!recipient) return recipient
  const r = String(recipient).trim()
  return channel === 'email' ? r.toLowerCase() : r
}

// Returns true when the recipient should NOT be contacted. Fails OPEN (returns
// false → allow the send) on any error: a missing suppression check is the
// safer failure than silently dropping legitimate mail.
export async function isSuppressed(channel, recipient) {
  if (env.NODE_ENV === 'test') return false
  if (!recipient) return false
  let client
  try {
    client = await pool.connect()
    return await repo.isSuppressed(client, {
      channel, recipient: normaliseRecipient(channel, recipient),
    })
  } catch (err) {
    logger.warn({ err, channel }, 'suppression check failed — proceeding (fail-open)')
    return false
  } finally {
    client?.release()
  }
}

// Add a recipient to the suppression list (called from the provider webhooks).
// Best-effort: a write failure is logged, never thrown.
export async function suppress({ channel, recipient, reason, detail }) {
  if (!recipient) return
  let client
  try {
    client = await pool.connect()
    const row = await repo.upsert(client, {
      channel, recipient: normaliseRecipient(channel, recipient), reason, detail,
    })
    logger.info({ channel, reason }, 'recipient suppressed')
    return row
  } catch (err) {
    logger.error({ err, channel, reason }, 'failed to write suppression')
  } finally {
    client?.release()
  }
}
