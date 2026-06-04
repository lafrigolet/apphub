// Push notifications via FCM HTTP v1.
//
// Auth flow:
//   1. Decode the service account JSON stored in
//      platform_notifications.config.fcm_service_account_json (encrypted).
//   2. Sign a JWT with the account's RS256 private key.
//   3. Exchange that JWT for an OAuth2 access token at
//      https://oauth2.googleapis.com/token (cached for ~1h).
//   4. POST messages to https://fcm.googleapis.com/v1/projects/<id>/messages:send
//      with Authorization: Bearer <accessToken>.
//
// FCM v1 supports Android, web (Web Push) and iOS (when paired with an
// uploaded APNs auth key in the Firebase console). Native APNs (HTTP/2 +
// :path /3/device/<token>) is intentionally not implemented here — the
// stored apns_* config keys are reserved for that future path.
//
// Dev-stub: when fcm_service_account_json is missing or env.NODE_ENV is
// 'development', sendPushToUser logs the call and returns { stub: true }.
import crypto from 'node:crypto'
import { env } from '../lib/env.js'
import { logger } from '../lib/logger.js'
import { pool, withTenantTransaction } from '../lib/db.js'
import * as configRepo from '../repositories/config.repository.js'
import * as pushRepo from '../repositories/push-devices.repository.js'
import { renderTemplate } from './template-renderer.js'
import { logSend } from './send-log.service.js'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SEND_URL  = (projectId) => `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`
const SCOPE     = 'https://www.googleapis.com/auth/firebase.messaging'

const CONFIG_TTL_MS = 30_000
const ACCESS_TOKEN_REFRESH_BEFORE_MS = 60_000   // refresh 1 min before expiry

let cfgCache    = { projectId: null, serviceAccount: null, expiresAt: 0 }
let tokenCache  = { accessToken: null, expiresAt: 0 }

async function loadCfg() {
  if (Date.now() < cfgCache.expiresAt) return cfgCache
  const client = await pool.connect()
  try {
    const projectId = await configRepo.getValue(client, 'fcm_project_id')
    const json      = await configRepo.getValue(client, 'fcm_service_account_json')
    let serviceAccount = null
    if (json) {
      try { serviceAccount = JSON.parse(json) }
      catch (err) { logger.error({ err }, 'fcm_service_account_json is not valid JSON') }
    }
    cfgCache = { projectId, serviceAccount, expiresAt: Date.now() + CONFIG_TTL_MS }
  } finally { client.release() }
  return cfgCache
}

export function invalidatePushConfigCache() {
  cfgCache.expiresAt = 0
  tokenCache = { accessToken: null, expiresAt: 0 }
}

function isStubMode(cfg) {
  // Stub on missing creds or while running tests. Not on NODE_ENV='development'
  // — compose base sets it even in prod, see email.service.js note.
  return env.NODE_ENV === 'test' || !cfg.projectId || !cfg.serviceAccount
}

// Build + sign the Google OAuth2 JWT bearer assertion.
function signServiceAccountJwt(sa) {
  const now = Math.floor(Date.now() / 1000)
  const header  = { alg: 'RS256', typ: 'JWT', kid: sa.private_key_id }
  const payload = {
    iss:   sa.client_email,
    scope: SCOPE,
    aud:   TOKEN_URL,
    iat:   now,
    exp:   now + 3600,
  }
  const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  const data = `${enc(header)}.${enc(payload)}`
  const signer = crypto.createSign('RSA-SHA256')
  signer.update(data)
  signer.end()
  const signature = signer.sign(sa.private_key, 'base64url')
  return `${data}.${signature}`
}

async function getAccessToken(sa) {
  if (tokenCache.accessToken && Date.now() < tokenCache.expiresAt - ACCESS_TOKEN_REFRESH_BEFORE_MS) {
    return tokenCache.accessToken
  }
  const assertion = signServiceAccountJwt(sa)
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  })
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`OAuth2 token exchange failed (${res.status}): ${text}`)
  }
  const data = await res.json()
  tokenCache = {
    accessToken: data.access_token,
    expiresAt:   Date.now() + (Number(data.expires_in) || 3600) * 1000,
  }
  return tokenCache.accessToken
}

async function sendOne({ token, title, body, data }, cfg, accessToken) {
  const message = { token, notification: { title, body } }
  if (data && Object.keys(data).length) {
    // FCM v1 requires every value in `data` to be a string.
    message.data = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]))
  }
  const res = await fetch(SEND_URL(cfg.projectId), {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message }),
  })
  if (res.ok) {
    const r = await res.json()
    return { name: r.name }
  }
  const text = await res.text().catch(() => '')
  // FCM error codes worth acting on:
  //   UNREGISTERED  → token no longer valid (uninstalled / signed out) → drop row.
  //   INVALID_ARGUMENT (with INVALID_REGISTRATION) → same handling.
  const looksDead = res.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/i.test(text)
  return { error: text || res.statusText, looksDead, status: res.status }
}

export async function sendPushToUser(ctx, userId, { title, body, data }) {
  const cfg = await loadCfg()

  // Audit best-effort hacia send_log — push sí tiene tenant context (ctx)
  // así que app_id/tenant_id/user_id van completos. template = data.type
  // (los wrappers lo fijan al event key).
  const audit = (status, error) => logSend({
    appId:     ctx?.appId,
    tenantId:  ctx?.tenantId,
    userId,
    channel:   'push',
    template:  data?.type,
    recipient: userId,
    status,
    error,
  })

  if (isStubMode(cfg)) {
    logger.info({ userId, title }, '[stub] push not sent — FCM not configured (or NODE_ENV=development)')
    await audit('skipped')
    return { stub: true }
  }

  // Pull the user's tokens. Use the tenant context the caller is running
  // under so RLS filters correctly.
  const tokens = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    pushRepo.tokensForUser(c, userId),
  )
  if (tokens.length === 0) {
    await audit('skipped', 'no registered devices')
    return { sent: 0 }
  }

  let accessToken
  try { accessToken = await getAccessToken(cfg.serviceAccount) }
  catch (err) {
    logger.error({ err, userId }, 'FCM token fetch failed')
    await audit('failed', err.message)
    return { error: err.message }
  }

  let sent = 0
  const dead = []
  for (const t of tokens) {
    const r = await sendOne({ token: t.token, title, body, data }, cfg, accessToken)
    if (r.name) sent += 1
    if (r.looksDead) dead.push(t.token)
    else if (r.error) logger.warn({ err: r.error, token: t.token, status: r.status }, 'FCM send failed')
  }
  // Garbage-collect dead tokens. Done outside the tenant tx because the
  // unique token constraint already scopes correctly.
  if (dead.length) {
    const client = await pool.connect()
    try { for (const tok of dead) await pushRepo.deleteByToken(client, tok) }
    finally { client.release() }
    logger.info({ userId, removed: dead.length }, 'pruned dead FCM tokens')
  }
  // 'sent' si al menos un device lo recibió; 'failed' si todos fallaron.
  if (sent > 0) await audit('sent')
  else await audit('failed', `0/${tokens.length} devices reached`)
  return { sent, dead: dead.length }
}

// ── Sender wrappers paralleling email + sms ─────────────────────────────

async function compose(key, vars, fallback, locale) {
  const fromDb = await renderTemplate(key, vars, 'push', locale)
  return fromDb ?? fallback
}

function intlLocale(loc) { return loc === 'en' ? 'en-GB' : 'es-ES' }

export async function sendBookingReminderPush(ctx, userId, { startsAt, window, locale = 'es' }) {
  const when = new Date(startsAt).toLocaleString(intlLocale(locale), { timeZone: 'Europe/Madrid' })
  const lead = locale === 'en'
    ? (window === 't_minus_24h' ? 'tomorrow' : 'in 2 hours')
    : (window === 't_minus_24h' ? 'mañana'   : 'en 2 horas')
  const tmpl = await compose('booking.reminder.due', { lead, when }, {
    subject: locale === 'en' ? `Appointment ${lead}` : `Cita ${lead}`,
    text:    locale === 'en' ? `Your appointment is ${lead} (${when})` : `Tu cita es ${lead} (${when})`,
  }, locale)
  return sendPushToUser(ctx, userId, { title: tmpl.subject, body: tmpl.text, data: { type: 'booking.reminder.due' } })
}

export async function sendBookingConfirmedPush(ctx, userId, { startsAt, locale = 'es' }) {
  const when = new Date(startsAt).toLocaleString(intlLocale(locale), { timeZone: 'Europe/Madrid' })
  const tmpl = await compose('booking.confirmed', { when }, {
    subject: locale === 'en' ? 'Appointment confirmed' : 'Cita confirmada',
    text:    locale === 'en' ? `Confirmed for ${when}` : `Confirmada para el ${when}`,
  }, locale)
  return sendPushToUser(ctx, userId, { title: tmpl.subject, body: tmpl.text, data: { type: 'booking.confirmed' } })
}

export async function sendReservationReminderPush(ctx, userId, { reservedFor, partySize, window, locale = 'es' }) {
  const when = new Date(reservedFor).toLocaleString(intlLocale(locale), { timeZone: 'Europe/Madrid' })
  const lead = locale === 'en'
    ? (window === 't_minus_24h' ? 'tomorrow' : 'in 2 hours')
    : (window === 't_minus_24h' ? 'mañana'   : 'en 2 horas')
  const tmpl = await compose('reservation.reminder.due', { lead, when, partySize }, {
    subject: locale === 'en' ? `Reservation ${lead}` : `Reserva ${lead}`,
    text:    locale === 'en' ? `${lead} (${when}) for ${partySize}` : `${lead} (${when}) para ${partySize}`,
  }, locale)
  return sendPushToUser(ctx, userId, { title: tmpl.subject, body: tmpl.text, data: { type: 'reservation.reminder.due' } })
}

// ── Reviews ──────────────────────────────────────────────────────────────
// The vendor replied to the buyer's review. Reviews carry userIds (not emails),
// so push is the resolvable channel.
export async function sendReviewRepliedPush(ctx, userId, { reviewId, locale = 'es' } = {}) {
  const tmpl = await compose('review.replied', {}, {
    subject: locale === 'en' ? 'New reply to your review' : 'Nueva respuesta a tu reseña',
    text:    locale === 'en' ? 'The seller has replied to your review.' : 'El vendedor ha respondido a tu reseña.',
  }, locale)
  return sendPushToUser(ctx, userId, { title: tmpl.subject, body: tmpl.text, data: { type: 'review.replied', reviewId } })
}

// ── Disputes ─────────────────────────────────────────────────────────────
// Dispute events carry buyer userIds (not emails) → push channel.
export async function sendDisputeOpenedPush(ctx, userId, { disputeId, orderId, locale = 'es' } = {}) {
  const tmpl = await compose('dispute.opened', {}, {
    subject: locale === 'en' ? 'Dispute opened' : 'Reclamación abierta',
    text:    locale === 'en' ? 'We have received your dispute and our team will review it shortly.' : 'Hemos recibido tu reclamación y nuestro equipo la revisará en breve.',
  }, locale)
  return sendPushToUser(ctx, userId, { title: tmpl.subject, body: tmpl.text, data: { type: 'dispute.opened', disputeId, orderId } })
}

export async function sendDisputeWithdrawnPush(ctx, userId, { disputeId, locale = 'es' } = {}) {
  const tmpl = await compose('dispute.withdrawn', {}, {
    subject: locale === 'en' ? 'Dispute withdrawn' : 'Reclamación retirada',
    text:    locale === 'en' ? 'Your dispute has been withdrawn and is now closed.' : 'Tu reclamación ha sido retirada y queda cerrada.',
  }, locale)
  return sendPushToUser(ctx, userId, { title: tmpl.subject, body: tmpl.text, data: { type: 'dispute.withdrawn', disputeId } })
}

// ── Packages ─────────────────────────────────────────────────────────────
// Package admin actions carry clientUserId (not email) → push channel.
export async function sendPackageFrozenPush(ctx, userId, { packageId, locale = 'es' } = {}) {
  const tmpl = await compose('package.frozen', {}, {
    subject: locale === 'en' ? 'Your package has been paused' : 'Tu bono se ha congelado',
    text:    locale === 'en' ? 'Your package has been paused. Its expiry is on hold until it is resumed.' : 'Tu bono se ha congelado. Su caducidad queda en pausa hasta que se reactive.',
  }, locale)
  return sendPushToUser(ctx, userId, { title: tmpl.subject, body: tmpl.text, data: { type: 'package.frozen', packageId } })
}

export async function sendPackageUnfrozenPush(ctx, userId, { packageId, daysAdded, locale = 'es' } = {}) {
  const days = daysAdded ?? 0
  const tmpl = await compose('package.unfrozen', { daysAdded: days }, {
    subject: locale === 'en' ? 'Your package is active again' : 'Tu bono vuelve a estar activo',
    text:    locale === 'en' ? `Your package is active again. We added ${days} day(s) to its expiry.` : `Tu bono vuelve a estar activo. Hemos añadido ${days} día(s) a su caducidad.`,
  }, locale)
  return sendPushToUser(ctx, userId, { title: tmpl.subject, body: tmpl.text, data: { type: 'package.unfrozen', packageId } })
}

export async function sendPackageRefundedPush(ctx, userId, { packageId, refundCents, currency, locale = 'es' } = {}) {
  const amount = refundCents != null
    ? new Intl.NumberFormat(intlLocale(locale), { style: 'currency', currency: currency || 'EUR' }).format(refundCents / 100)
    : ''
  const tmpl = await compose('package.refunded', { amount }, {
    subject: locale === 'en' ? 'Package refunded' : 'Bono reembolsado',
    text:    locale === 'en' ? `Your package has been refunded${amount ? ` (${amount})` : ''}. It can take several days to appear on your statement.` : `Tu bono ha sido reembolsado${amount ? ` (${amount})` : ''}. Puede tardar varios días en reflejarse en tu cuenta.`,
  }, locale)
  return sendPushToUser(ctx, userId, { title: tmpl.subject, body: tmpl.text, data: { type: 'package.refunded', packageId } })
}
