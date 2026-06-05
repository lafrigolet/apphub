// Inbound email pipeline (§24–§28) — webhook `email.received` → fetch full
// content from the Receiving API → store attachments → correlate → route to a
// domain event on platform.events.
//
// FSM (inbound_emails.status):
//   received → fetched → routed | unrouted | archived | quarantined | failed
//
//   routed      a reply token or inbound_routes rule matched; the rule's
//               target_event was published with the email payload.
//   unrouted    nothing matched, fallback 'archive' (kept visible to staff).
//   archived    auto-replies (mail-loop guard) and fallback 'discard'.
//   quarantined withheld before fetch: blocked/not-allowlisted sender,
//               self-loop, per-sender rate limit.
//   failed      processing threw; attempts++ — staff can reprocess.
//
// The generic `email.inbound.received` event is always published for processed
// (non-quarantined, non-failed) mail so observers don't depend on routing rules.
import crypto from 'node:crypto'
import { pool } from '../lib/db.js'
import { redis, publish } from '../lib/redis.js'
import { logger } from '../lib/logger.js'
import {
  extractReply, detectAutoReply, headerValue, parseAddress, parsePlusAddress,
} from '../lib/email-reply.js'
import * as inboundRepo from '../repositories/inbound-emails.repository.js'
import * as routesRepo from '../repositories/inbound-routes.repository.js'
import * as tokensRepo from '../repositories/inbound-reply-tokens.repository.js'
import * as sendLogRepo from '../repositories/send-log.repository.js'
import { fetchReceivedEmail } from './resend-inbound.service.js'
import { storeAttachments, deleteStoredObjects } from './inbound-attachments.service.js'
import { getInboundConfig } from './inbound-config.service.js'

const DEFAULT_SENDER_RATE_LIMIT = 30 // per hour

// ── Webhook entry ───────────────────────────────────────────────────────────
// Called by webhook.service on `email.received`. Persists the metadata row
// (idempotent on provider_email_id) and runs the pipeline. Errors are absorbed
// into the row's failed state — the webhook route always 200s regardless.
export async function handleInboundReceived(data) {
  const providerEmailId = data?.email_id ?? data?.id ?? null
  if (!providerEmailId) return { ignored: true, reason: 'no email_id' }
  const from = parseAddress(data.from)
  if (!from.address) return { ignored: true, reason: 'no from' }

  const client = await pool.connect()
  let row
  try {
    row = await inboundRepo.upsertReceived(client, {
      providerEmailId,
      fromAddress: from.address,
      fromName: from.name,
      toAddresses: (Array.isArray(data.to) ? data.to : [data.to]).filter(Boolean).map((a) => parseAddress(a).address),
      subject: data.subject ?? null,
      receivedAt: data.created_at ?? null,
    })
  } finally {
    client.release()
  }
  // Redelivered webhook for a message we already processed → no-op.
  if (!row.inserted && row.status !== 'received') {
    return { duplicate: true, id: row.id }
  }
  const result = await processInbound(row, { webhookAttachments: data.attachments ?? [] })
  return { handled: true, id: row.id, ...result }
}

// ── Pipeline ────────────────────────────────────────────────────────────────
export async function processInbound(row, { webhookAttachments = [], injected = null } = {}) {
  const client = await pool.connect()
  try {
    const cfg = await getInboundConfig()

    // Security gates (§28) — evaluated before any provider fetch.
    const gate = await securityGate(row, cfg)
    if (gate) {
      await inboundRepo.markQuarantined(client, row.id, gate)
      logger.warn({ id: row.id, from: row.from_address, gate }, 'inbound email quarantined')
      return { quarantined: gate }
    }

    // Fetch full content (§24). `injected` (admin/dev inject) skips the
    // provider; stub mode (no API key) proceeds with webhook metadata only.
    let content = injected
    if (!content && !row.provider_email_id.startsWith('inject_')) {
      content = await fetchReceivedEmail({ apiKey: cfg.resend_api_key, emailId: row.provider_email_id })
    }
    const headers = content?.headers ?? {}
    const isAutoReply = detectAutoReply({
      headers, fromAddress: row.from_address, subject: content?.subject ?? row.subject,
    })
    const fetched = await inboundRepo.markFetched(client, row.id, {
      bodyText: content?.text ?? null,
      bodyHtml: content?.html ?? null,
      headers,
      messageId: content?.messageId ?? headerValue(headers, 'message-id'),
      inReplyTo: headerValue(headers, 'in-reply-to'),
      replyTo: content?.replyTo ?? null,
      authResults: headerValue(headers, 'authentication-results'),
      isAutoReply,
    }) ?? row

    // Attachments (§25) — per-attachment failures never lose the message.
    const attachmentMetas = injected?.attachments ?? content?.attachments ?? []
    const attachments = attachmentMetas.length
      ? await storeAttachments(client, {
          email: fetched, attachments: attachmentMetas,
          inline: !!injected, apiKey: cfg.resend_api_key, cfg,
        })
      : []

    // Correlation (§27): In-Reply-To/References ↔ send_log.provider_message_id.
    const correlation = await correlate(client, fetched, headers)

    const payload = buildEventPayload(fetched, attachments, correlation)

    // Mail-loop guard: auto-replies are archived, never routed (§28).
    if (isAutoReply) {
      await inboundRepo.markArchived(client, row.id, 'archived')
      await safePublish('email.inbound.received', { ...payload, autoReply: true, disposition: 'archived' })
      return { archived: 'auto_reply' }
    }

    // Routing (§26): reply token > exact route > domain route > fallback.
    const routed = await route(client, fetched, cfg, payload)
    await safePublish('email.inbound.received', { ...payload, ...routed.audit })
    return routed.result
  } catch (err) {
    logger.error({ err, id: row.id }, 'inbound pipeline failed')
    try {
      await inboundRepo.markFailed(client, row.id, err.message)
    } catch (markErr) {
      logger.error({ err: markErr, id: row.id }, 'could not mark inbound email as failed')
    }
    return { failed: true }
  } finally {
    client.release()
  }
}

// Staff reprocess (dead-letter recovery / after fixing routes).
export async function reprocess(id) {
  const client = await pool.connect()
  let row
  try {
    row = await inboundRepo.resetForReprocess(client, id)
  } finally {
    client.release()
  }
  if (!row) return null
  return processInbound(row)
}

// Dev-stub / admin inject (§23): runs the same pipeline on a synthetic email
// without touching Resend. Attachments come inline as base64.
export async function injectInbound(input) {
  const from = parseAddress(input.from)
  const client = await pool.connect()
  let row
  try {
    row = await inboundRepo.upsertReceived(client, {
      providerEmailId: `inject_${crypto.randomUUID()}`,
      fromAddress: from.address,
      fromName: from.name,
      toAddresses: (input.to ?? []).map((a) => parseAddress(a).address),
      subject: input.subject ?? null,
    })
  } finally {
    client.release()
  }
  const result = await processInbound(row, {
    injected: {
      text: input.text ?? null,
      html: input.html ?? null,
      headers: input.headers ?? {},
      subject: input.subject ?? null,
      messageId: input.messageId ?? null,
      attachments: input.attachments ?? [],
    },
  })
  return { id: row.id, ...result }
}

// Retention purge (§29) — triggered by platform-scheduler via
// `notifications.inbound.purge_due`. Rows cascade their attachment metadata;
// stored S3 objects and expired reply tokens are cleaned alongside.
export async function purgeInbound(retentionDays) {
  const days = Number(retentionDays)
  if (!Number.isFinite(days) || days <= 0) return { skipped: 'invalid retentionDays' }
  const client = await pool.connect()
  let purged, tokensPurged
  try {
    purged = await inboundRepo.purgeOlderThan(client, String(days))
    tokensPurged = await tokensRepo.purgeExpired(client)
  } finally {
    client.release()
  }
  const objectsDeleted = await deleteStoredObjects(purged.objectKeys)
  logger.info({ deleted: purged.deleted, objectsDeleted, tokensPurged, retentionDays: days }, 'inbound emails purged by retention policy')
  return { deleted: purged.deleted, objectsDeleted, tokensPurged }
}

// ── Gates (§28) ─────────────────────────────────────────────────────────────
function listMatch(csv, address) {
  if (!csv) return false
  const addr = address.toLowerCase()
  const domain = addr.split('@')[1] ?? ''
  return String(csv).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    .some((entry) => entry === addr || entry === domain || entry === `@${domain}`)
}

async function securityGate(row, cfg) {
  const sender = row.from_address
  // Never ingest our own outbound sender — that's a loop, not a conversation.
  if (cfg.sender_email && sender === String(cfg.sender_email).toLowerCase()) return 'self_loop'
  if (listMatch(cfg.inbound_blocked_senders, sender)) return 'blocked_sender'
  if (cfg.inbound_allowed_senders && !listMatch(cfg.inbound_allowed_senders, sender)) return 'sender_not_allowed'

  // Per-sender ingestion rate limit (a hostile sender must not mint 1 000
  // leads/tickets). Fail-open on Redis trouble — prefer double work to loss.
  const limit = Number(cfg.inbound_rate_limit_per_sender_per_hour) > 0
    ? Number(cfg.inbound_rate_limit_per_sender_per_hour)
    : DEFAULT_SENDER_RATE_LIMIT
  try {
    const key = `nin:rl:${sender}`
    const n = await redis.incr(key)
    if (n === 1) await redis.expire(key, 3660)
    if (n > limit) return 'rate_limited'
  } catch (err) {
    logger.warn({ err, sender }, 'inbound rate-limit check failed (fail-open)')
  }
  return null
}

// ── Correlation (§27) ───────────────────────────────────────────────────────
// Candidates: every msg-id token in In-Reply-To + References, both as-is and
// stripped of the @domain part (Resend's outbound id may appear as the local
// part of the Message-ID it generates).
async function correlate(client, row, headers) {
  const raw = [row.in_reply_to, headerValue(headers, 'references')].filter(Boolean).join(' ')
  if (!raw) return { inReplyTo: row.in_reply_to ?? null, sendLogId: null }
  const ids = [...raw.matchAll(/<([^>]+)>/g)].map((m) => m[1])
  const candidates = [...new Set(ids.flatMap((id) => [id, id.split('@')[0]]))]
  let hit = null
  try {
    hit = await sendLogRepo.findByProviderMessageIds(client, candidates)
  } catch (err) {
    logger.warn({ err }, 'inbound correlation lookup failed')
  }
  return {
    inReplyTo: row.in_reply_to ?? null,
    sendLogId: hit?.id ?? null,
    correlatedTemplate: hit?.template ?? null,
    correlatedUserId: hit?.user_id ?? null,
  }
}

// ── Routing (§26) ───────────────────────────────────────────────────────────
async function route(client, row, cfg, payload) {
  // 1. Plus-addressed reply token: reply+<token>@<inbound_domain>.
  for (const addr of row.to_addresses ?? []) {
    const plus = parsePlusAddress(addr)
    if (!plus) continue
    if (cfg.inbound_domain && plus.domain !== String(cfg.inbound_domain).toLowerCase()) continue
    const token = await tokensRepo.findValid(client, plus.token)
    if (!token) continue
    await tokensRepo.recordUse(client, plus.token)
    await safePublish(token.target_event, {
      ...payload,
      appId: token.app_id ?? null,
      tenantId: token.tenant_id ?? null,
      context: token.context ?? {},
    })
    await inboundRepo.markRouted(client, row.id, {
      routedEvent: token.target_event, appId: token.app_id, tenantId: token.tenant_id,
    })
    return {
      result: { routed: token.target_event, via: 'reply_token' },
      audit: { disposition: 'routed', routedEvent: token.target_event, via: 'reply_token' },
    }
  }

  // 2. Address rules (exact beats domain catch-all; first matching recipient wins).
  for (const addr of row.to_addresses ?? []) {
    const rule = await routesRepo.findMatch(client, addr)
    if (!rule) continue
    await safePublish(rule.target_event, {
      ...payload,
      appId: rule.app_id ?? null,
      tenantId: rule.tenant_id ?? null,
      matchedAddress: addr,
    })
    await inboundRepo.markRouted(client, row.id, {
      routeId: rule.id, routedEvent: rule.target_event, appId: rule.app_id, tenantId: rule.tenant_id,
    })
    return {
      result: { routed: rule.target_event, via: 'route', routeId: rule.id },
      audit: { disposition: 'routed', routedEvent: rule.target_event, via: 'route' },
    }
  }

  // 3. Fallback: 'archive' keeps it visible as unrouted; 'discard' archives it.
  const discard = String(cfg.inbound_fallback_action ?? '').toLowerCase() === 'discard'
  await inboundRepo.markArchived(client, row.id, discard ? 'archived' : 'unrouted')
  return {
    result: { unrouted: true, disposition: discard ? 'archived' : 'unrouted' },
    audit: { disposition: discard ? 'archived' : 'unrouted' },
  }
}

// ── Payload ─────────────────────────────────────────────────────────────────
// What domain consumers receive. body_html is deliberately omitted (size);
// `text` is the cleaned reply (quoted history + signature stripped), `rawText`
// the full plain body. Attachment bytes live in S3 — only keys travel.
function buildEventPayload(row, attachments, correlation) {
  return {
    inboundEmailId: row.id,
    providerEmailId: row.provider_email_id,
    from: row.from_address,
    fromName: row.from_name ?? null,
    to: row.to_addresses ?? [],
    subject: row.subject ?? null,
    text: extractReply(row.body_text),
    rawText: row.body_text ?? null,
    attachments: attachments
      .filter((a) => a.status === 'stored')
      .map((a) => ({
        id: a.id, filename: a.filename, contentType: a.content_type,
        sizeBytes: a.size_bytes == null ? null : Number(a.size_bytes),
        bucket: a.bucket, objectKey: a.object_key,
      })),
    correlation,
    receivedAt: row.received_at,
  }
}

async function safePublish(type, payload) {
  try {
    await publish({ type, payload })
  } catch (err) {
    logger.error({ err, type }, 'inbound event publish failed')
  }
}
