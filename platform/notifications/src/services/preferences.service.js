// User notification preferences — opt-out gate consulted by the event consumer
// and the public/authenticated preference endpoints.
//
// Categories are a coarse grouping over event types so a user can mute, say,
// every "marketing" message while keeping transactional ones. Unknown event
// types map to 'other'. Transactional categories (auth, security) are NOT
// listed here because they should never be mutable — `isMuted` short-circuits
// to false for them regardless of any stored row.

import crypto from 'node:crypto'
import { pool, withTenantTransaction } from '../lib/db.js'
import { logger } from '../lib/logger.js'
import * as repo from '../repositories/preferences.repository.js'

// event.type → category. Prefix match on the dotted namespace.
const CATEGORY_BY_PREFIX = [
  ['auth.', 'auth'],
  ['user.', 'auth'],
  ['tenant.', 'auth'],
  ['booking.', 'bookings'],
  ['reservation.', 'bookings'],
  ['package.', 'bookings'],
  ['order.', 'orders'],
  ['basket.', 'marketing'],
  ['donation.', 'donations'],
  ['payout.', 'payouts'],
  ['dispute.', 'disputes'],
  ['chat.', 'chat'],
  ['inquiry.', 'inquiries'],
  ['lead.', 'leads'],
]

// Categories the user is never allowed to mute (legally/operationally required
// transactional messages). Mapped through categoryFor below.
const NON_MUTABLE = new Set(['auth'])

// Categories surfaced to the user as toggleable. Order is the display order.
export const MUTABLE_CATEGORIES = [
  'bookings', 'orders', 'donations', 'payouts',
  'disputes', 'chat', 'marketing',
]

export function categoryForEvent(eventType) {
  if (!eventType) return 'other'
  for (const [prefix, cat] of CATEGORY_BY_PREFIX) {
    if (eventType.startsWith(prefix)) return cat
  }
  return 'other'
}

// Consumer gate. Returns true when the send should be suppressed.
// Fails CLOSED for nothing and OPEN on errors / missing tenant context:
// a preferences lookup must never silently swallow a notification, and a
// non-mutable (transactional) category is always allowed through.
export async function isMuted({ userId, eventType, channel, appId, tenantId, subTenantId }) {
  if (!userId) return false
  const category = categoryForEvent(eventType)
  if (NON_MUTABLE.has(category)) return false
  // Without tenant context we cannot satisfy RLS — fail open (send).
  if (!appId || !tenantId) return false
  try {
    return await withTenantTransaction(pool, appId, tenantId, subTenantId ?? null, (c) =>
      repo.isMutedFor(c, { userId, category, channel }),
    )
  } catch (err) {
    logger.warn({ err, userId, eventType, channel }, 'preference check failed — proceeding (fail-open)')
    return false
  }
}

// ── unsubscribe token ──────────────────────────────────────────────────────

export function mintToken() {
  return crypto.randomBytes(24).toString('base64url')
}

// Ensure a stable unsubscribe token exists for (user); returns it. Runs without
// RLS (unsubscribe_tokens has none) so it works from any context.
export async function ensureUnsubscribeToken({ appId, tenantId, userId }) {
  const client = await pool.connect()
  try {
    return await repo.upsertToken(client, { appId, tenantId, userId, token: mintToken() })
  } finally {
    client.release()
  }
}
