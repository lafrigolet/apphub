// Inbound runtime config — DB-backed (admin PATCH /admin/config) with a 30s
// in-memory cache, same pattern as the email/SMS/push config caches.
import { pool } from '../lib/db.js'
import * as configRepo from '../repositories/config.repository.js'

const KEYS = [
  'resend_api_key',
  'sender_email',
  'inbound_enabled',
  'inbound_domain',
  'inbound_fallback_action',
  'inbound_blocked_senders',
  'inbound_allowed_senders',
  'inbound_attachment_max_bytes',
  'inbound_attachment_allowed_types',
  'inbound_rate_limit_per_sender_per_hour',
  'inbound_retention_days',
]

let cache = null
let cacheAt = 0
const TTL_MS = 30_000

export function invalidateInboundConfigCache() {
  cache = null
  cacheAt = 0
}

export async function getInboundConfig() {
  if (cache && Date.now() - cacheAt < TTL_MS) return cache
  const client = await pool.connect()
  try {
    const cfg = {}
    for (const key of KEYS) cfg[key] = await configRepo.getValue(client, key)
    cache = cfg
    cacheAt = Date.now()
    return cfg
  } finally {
    client.release()
  }
}

export function isInboundEnabled(cfg) {
  return String(cfg?.inbound_enabled ?? '').toLowerCase() === 'true'
}
