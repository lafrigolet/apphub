// Reply-address minting (§27) — when an outbound notification wants its
// replies back in-platform, it sets Reply-To to a plus-addressed token:
//   reply+<token>@<inbound_domain>
// The token maps to a target event + context (e.g. { inquiryId, party }).
// Returns null when inbound is disabled or no receiving domain is configured —
// callers fall back to their previous Reply-To behaviour.
import crypto from 'node:crypto'
import { pool } from '../lib/db.js'
import { logger } from '../lib/logger.js'
import * as tokensRepo from '../repositories/inbound-reply-tokens.repository.js'
import { getInboundConfig, isInboundEnabled } from './inbound-config.service.js'

const DEFAULT_TTL_DAYS = 90

export async function mintReplyAddress({ targetEvent, context = {}, appId = null, tenantId = null, ttlDays = DEFAULT_TTL_DAYS }) {
  try {
    const cfg = await getInboundConfig()
    if (!isInboundEnabled(cfg) || !cfg.inbound_domain) return null
    // hex, not base64url: email local-parts get lowercased along the way
    // (clients, our own normalisation), so the token must be case-insensitive.
    const token = crypto.randomBytes(10).toString('hex') // 20 chars
    const expiresAt = ttlDays ? new Date(Date.now() + ttlDays * 86_400_000) : null
    const client = await pool.connect()
    try {
      await tokensRepo.insert(client, { token, targetEvent, context, appId, tenantId, expiresAt })
    } finally {
      client.release()
    }
    return `reply+${token}@${cfg.inbound_domain}`
  } catch (err) {
    // Best-effort: a minting failure must never block the outbound send.
    logger.error({ err, targetEvent }, 'mintReplyAddress failed')
    return null
  }
}
