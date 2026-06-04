import { withTenantTransaction } from '../lib/db.js'
import { logger } from '../lib/logger.js'
import { generateReference } from '../lib/reference.js'
import * as repo from '../repositories/inquiries.repository.js'
import * as settingsRepo from '../repositories/settings.repository.js'
import * as settingsService from './settings.service.js'
import {
  ConflictError, ForbiddenError, NotFoundError, ValidationError,
} from '@apphub/platform-sdk/errors'

const ADMIN_ROLES = new Set(['owner', 'admin', 'staff', 'super_admin'])

// FSM declarada para audit: transiciones permitidas y campos de stamp.
// `resolved` y `closed` son cierres distintos (resuelto vs archivado); ambos
// terminales junto a `spam`. No hay reapertura en V1.
const TRANSITIONS = {
  new:       new Set(['contacted', 'resolved', 'closed', 'spam']),
  contacted: new Set(['resolved', 'closed', 'spam']),
  resolved:  new Set([]),
  closed:    new Set([]),
  spam:      new Set([]),
}

function requireAdmin(identity) {
  if (!identity?.userId) throw new ForbiddenError()
  if (!ADMIN_ROLES.has(identity.role)) throw new ForbiddenError('Only admin/staff')
}

// Publica DESPUÉS del COMMIT — un fallo al publicar NO propaga: mejor la fila
// persistida sin notificación que perder la operación.
async function publish(redis, type, payload) {
  if (!redis) return
  try {
    await redis.publish('platform.events', JSON.stringify({ type, payload }))
  } catch (err) {
    logger.error({ err, type }, `failed to publish ${type}`)
  }
}

// ── Acceso público: form submit ──────────────────────────────────────
//
// El caller NO necesita JWT — el form es público. appId+tenantId vienen
// EN el body. RLS scope se setea con esos valores en withTenantTransaction.
// Antes de persistir resolvemos settings; sin contact_inbox_email
// configurado el módulo NO puede cumplir su contrato (no hay a quién
// alertar) → 422.
export async function create({ redis }, input) {
  const {
    appId, tenantId, subTenantId,
    contactName, email, phone, subject, message,
    source, category, metadata, ip, userAgent,
    consentText, consentVersion,
  } = input

  if (!appId || !tenantId) throw new ValidationError('appId y tenantId requeridos')
  if (!contactName)        throw new ValidationError('contactName requerido')
  if (!email)              throw new ValidationError('email requerido')
  if (!message)            throw new ValidationError('message requerido')

  const reference = generateReference()
  const result = await withTenantTransaction(appId, tenantId, subTenantId ?? null, async (c) => {
    const settings = await settingsService.resolveContactInbox(c, appId, tenantId)
    let row
    try {
      row = await repo.insert(c, {
        reference,
        appId, tenantId, subTenantId,
        contactName, email, phone, subject, message,
        source, category, metadata, ip, userAgent,
        consentText, consentVersion,
        // Consentimiento LOPDGDD: si el form mandó texto/versión, sellamos el
        // momento de la aceptación.
        consentAt: (consentText || consentVersion) ? new Date() : null,
      })
    } catch (err) {
      // UNIQUE collision en reference (extremadamente improbable: 6 chars
      // base32 ≈ 1B/día). Si pasa, propagamos como ConflictError para que
      // el caller reintente.
      if (err.code === '23505') throw new ConflictError('reference collision — retry')
      throw err
    }
    return { row, settings }
  })

  // Publish DESPUÉS del COMMIT — si fallamos aquí, la consulta queda
  // persistida (el admin puede verla en /admin) pero el email no se manda.
  // Mejor row sin email que email sin row.
  await publish(redis, 'inquiry.created', {
    appId, tenantId, subTenantId: subTenantId ?? null,
    inquiryId:          result.row.id,
    reference:          result.row.reference,
    contactName:        result.row.contact_name,
    email:              result.row.email,
    phone:              result.row.phone,
    subject:            result.row.subject,
    message:            result.row.message,
    category:           result.row.category,
    contactInboxEmail:  result.settings.contact_inbox_email,
    replyToEmail:       result.settings.reply_to_email ?? result.settings.contact_inbox_email,
    userThanksSubject:  result.settings.user_thanks_subject,
    userThanksBody:     result.settings.user_thanks_body,
  })

  return result.row
}

// ── CSAT público (#10/#15) ───────────────────────────────────────────
//
// El visitante puntúa la atención recibida sin JWT: se identifica con la
// referencia citable + el email con que envió la consulta (capability check).
// Solo se acepta una vez (csat_submitted_at se sella) y solo sobre consultas
// ya cerradas (resolved/closed) — no tiene sentido valorar algo en curso.
const CSAT_ELIGIBLE = new Set(['resolved', 'closed'])

export async function submitCsat({ redis }, { appId, tenantId, reference, email, score, comment }) {
  if (!appId || !tenantId) throw new ValidationError('appId y tenantId requeridos')
  if (!reference)          throw new ValidationError('reference requerida')
  if (!email)              throw new ValidationError('email requerido')
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    throw new ValidationError('score debe ser un entero entre 1 y 5')
  }

  const out = await withTenantTransaction(appId, tenantId, null, async (c) => {
    const existing = await repo.findByReference(c, reference)
    // 404 indistinguible: ni "no existe" ni "email no coincide" revelan datos.
    if (!existing) throw new NotFoundError('Inquiry')
    if (existing.email.toLowerCase() !== email.toLowerCase()) throw new NotFoundError('Inquiry')
    if (!CSAT_ELIGIBLE.has(existing.status)) {
      throw new ConflictError('CSAT only available once the inquiry is resolved or closed')
    }
    if (existing.csat_submitted_at) {
      throw new ConflictError('CSAT already submitted')
    }
    const updated = await repo.submitCsat(c, existing.id, { score, comment })
    if (!updated) throw new ConflictError('CSAT already submitted')
    return { id: existing.id, updated }
  })

  await publish(redis, 'inquiry.csat_submitted', {
    appId, tenantId, inquiryId: out.id, reference, score,
  })
  return { reference, score, submittedAt: out.updated.csat_submitted_at }
}

// ── Admin lookups ────────────────────────────────────────────────────

export async function listAdmin(identity, filters = {}) {
  requireAdmin(identity)
  // `assignedTo='me'` → resolver al userId del staff que consulta.
  const resolved = { ...filters }
  if (resolved.assignedTo === 'me') resolved.assignedTo = identity.userId
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId ?? null, (c) =>
    repo.list(c, resolved),
  )
}

export async function getById(identity, id) {
  requireAdmin(identity)
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId ?? null, async (c) => {
    const row = await repo.findById(c, id)
    if (!row) throw new NotFoundError('Inquiry')
    return row
  })
}

// FSM transition. status puede ser undefined si solo se cambian staff_notes.
// Registra una entrada en el timeline (status_change) con autor del staff y
// publica `inquiry.status_changed`. closeReason se sella al resolver/cerrar.
export async function update(identity, id, { status, staffNotes, closeReason }) {
  requireAdmin(identity)
  const out = await withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId ?? null, async (c) => {
    const existing = await repo.findById(c, id)
    if (!existing) throw new NotFoundError('Inquiry')

    let nextStatus = existing.status
    let changed = false
    if (status && status !== existing.status) {
      const allowed = TRANSITIONS[existing.status]
      if (!allowed || !allowed.has(status)) {
        throw new ConflictError(`cannot transition from ${existing.status} to ${status}`)
      }
      nextStatus = status
      changed = true
    }
    const updated = await repo.updateStatus(c, id, nextStatus, staffNotes, closeReason)
    if (!updated) throw new NotFoundError('Inquiry')

    if (changed) {
      await repo.insertActivity(c, id, {
        appId: identity.appId, tenantId: identity.tenantId,
        authorUserId: identity.userId, authorEmail: identity.email ?? null,
        type: 'status_change',
        body: closeReason ?? null,
        metadata: { from: existing.status, to: nextStatus },
      })
    }
    return { updated, changed, from: existing.status }
  })

  if (out.changed) {
    await publish(identity.redis, 'inquiry.status_changed', {
      appId: identity.appId, tenantId: identity.tenantId,
      inquiryId: id, from: out.from, to: out.updated.status,
      closeReason: closeReason ?? null, byUserId: identity.userId,
    })
  }
  return out.updated
}

// ── Asignación a staff (#8) ──────────────────────────────────────────

export async function assign(identity, id, assignedTo) {
  requireAdmin(identity)
  const out = await withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId ?? null, async (c) => {
    const existing = await repo.findById(c, id)
    if (!existing) throw new NotFoundError('Inquiry')
    if (existing.assigned_to === (assignedTo ?? null)) return { updated: existing, changed: false }
    const updated = await repo.assign(c, id, assignedTo ?? null)
    await repo.insertActivity(c, id, {
      appId: identity.appId, tenantId: identity.tenantId,
      authorUserId: identity.userId, authorEmail: identity.email ?? null,
      type: 'assignment',
      metadata: { from: existing.assigned_to, to: assignedTo ?? null },
    })
    return { updated, changed: true }
  })
  if (out.changed) {
    await publish(identity.redis, 'inquiry.assigned', {
      appId: identity.appId, tenantId: identity.tenantId,
      inquiryId: id, assignedTo: assignedTo ?? null, byUserId: identity.userId,
    })
  }
  return out.updated
}

// ── Notas con autoría (#3) — sustituye staff_notes plano ─────────────

export async function addNote(identity, id, body) {
  requireAdmin(identity)
  if (!body) throw new ValidationError('note body requerido')
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId ?? null, async (c) => {
    const existing = await repo.findById(c, id)
    if (!existing) throw new NotFoundError('Inquiry')
    return repo.insertActivity(c, id, {
      appId: identity.appId, tenantId: identity.tenantId,
      authorUserId: identity.userId, authorEmail: identity.email ?? null,
      type: 'note', body,
    })
  })
}

export async function listActivities(identity, id, opts) {
  requireAdmin(identity)
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId ?? null, async (c) => {
    const existing = await repo.findById(c, id)
    if (!existing) throw new NotFoundError('Inquiry')
    return repo.listActivities(c, id, opts)
  })
}

// ── Analítica agregada (#15) ─────────────────────────────────────────

export async function analytics(identity, window) {
  requireAdmin(identity)
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId ?? null, (c) =>
    repo.analytics(c, window ?? {}),
  )
}

// ── GDPR — retención / purga automática (#9, #17) ────────────────────
//
// Anonimiza las consultas más viejas que `retention_days` (config del tenant).
// Pensado para que platform/scheduler lo invoque por tenant (job `inquiry-
// retention-purge`). No-op si el tenant no configuró retention_days. No borra
// físico: anonymize() limpia la PII conservando datos analíticos agregados.
// `identity` es la identidad de servicio del scheduler; basta appId+tenantId.
export async function purgeRetention(identity, { batchSize = 500 } = {}) {
  const out = await withTenantTransaction(identity.appId, identity.tenantId, null, async (c) => {
    const settings = await settingsRepo.findByAppTenant(c, identity.appId, identity.tenantId)
    const retentionDays = settings?.retention_days
    if (!retentionDays) return { anonymized: 0, ids: [] }

    const olderThan = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
    const dueIds = await repo.findRetentionDue(c, olderThan, batchSize)
    const ids = []
    for (const id of dueIds) {
      const anon = await repo.anonymize(c, id)
      if (anon) {
        ids.push(id)
        await repo.insertActivity(c, id, {
          appId: identity.appId, tenantId: identity.tenantId,
          authorUserId: null, authorEmail: null,
          type: 'system', body: `GDPR retention purge (>${retentionDays}d, anonymized)`,
        })
      }
    }
    return { anonymized: ids.length, ids }
  })

  if (out.anonymized > 0) {
    await publish(identity.redis, 'inquiry.retention_purged', {
      appId: identity.appId, tenantId: identity.tenantId,
      count: out.anonymized,
    })
  }
  return out
}

// ── GDPR — supresión / anonimización (#9, #17) ───────────────────────

export async function remove(identity, id) {
  requireAdmin(identity)
  const out = await withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId ?? null, async (c) => {
    const existing = await repo.findById(c, id)
    if (!existing) throw new NotFoundError('Inquiry')
    await repo.softDelete(c, id)
    const anonymized = await repo.anonymize(c, id)
    await repo.insertActivity(c, id, {
      appId: identity.appId, tenantId: identity.tenantId,
      authorUserId: identity.userId, authorEmail: identity.email ?? null,
      type: 'system', body: 'GDPR erasure (soft-delete + anonymize)',
    })
    return anonymized ?? existing
  })
  // El evento NO lleva PII — es justo lo que acabamos de borrar.
  await publish(identity.redis, 'inquiry.deleted', {
    appId: identity.appId, tenantId: identity.tenantId,
    inquiryId: id, byUserId: identity.userId,
  })
  return out
}
