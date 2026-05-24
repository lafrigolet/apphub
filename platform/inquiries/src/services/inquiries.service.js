import { withTenantTransaction } from '../lib/db.js'
import { logger } from '../lib/logger.js'
import { generateReference } from '../lib/reference.js'
import * as repo from '../repositories/inquiries.repository.js'
import * as settingsService from './settings.service.js'
import {
  ConflictError, ForbiddenError, NotFoundError, ValidationError,
} from '@apphub/platform-sdk/errors'

const ADMIN_ROLES = new Set(['owner', 'admin', 'staff', 'super_admin'])

// FSM declarada para audit: transiciones permitidas y campos de stamp.
// Los terminales (closed, spam) no aceptan más cambios de status.
const TRANSITIONS = {
  new:       new Set(['contacted', 'closed', 'spam']),
  contacted: new Set(['closed', 'spam']),
  closed:    new Set([]),
  spam:      new Set([]),
}

function requireAdmin(identity) {
  if (!identity?.userId) throw new ForbiddenError()
  if (!ADMIN_ROLES.has(identity.role)) throw new ForbiddenError('Only admin/staff')
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
    source, metadata, ip, userAgent,
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
        source, metadata, ip, userAgent,
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
  if (redis) {
    try {
      const channel = 'platform.events'
      await redis.publish(channel, JSON.stringify({
        type: 'inquiry.created',
        payload: {
          appId, tenantId, subTenantId: subTenantId ?? null,
          inquiryId:          result.row.id,
          reference:          result.row.reference,
          contactName:        result.row.contact_name,
          email:              result.row.email,
          phone:              result.row.phone,
          subject:            result.row.subject,
          message:            result.row.message,
          contactInboxEmail:  result.settings.contact_inbox_email,
          replyToEmail:       result.settings.reply_to_email ?? result.settings.contact_inbox_email,
          userThanksSubject:  result.settings.user_thanks_subject,
          userThanksBody:     result.settings.user_thanks_body,
        },
      }))
    } catch (err) {
      logger.error({ err, inquiryId: result.row.id }, 'failed to publish inquiry.created')
    }
  }

  return result.row
}

// ── Admin lookups ────────────────────────────────────────────────────

export async function listAdmin(identity, filters) {
  requireAdmin(identity)
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId ?? null, (c) =>
    repo.list(c, filters),
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
export async function update(identity, id, { status, staffNotes }) {
  requireAdmin(identity)
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId ?? null, async (c) => {
    const existing = await repo.findById(c, id)
    if (!existing) throw new NotFoundError('Inquiry')

    let nextStatus = existing.status
    if (status && status !== existing.status) {
      const allowed = TRANSITIONS[existing.status]
      if (!allowed || !allowed.has(status)) {
        throw new ConflictError(`cannot transition from ${existing.status} to ${status}`)
      }
      nextStatus = status
    }
    const updated = await repo.updateStatus(c, id, nextStatus, staffNotes)
    if (!updated) throw new NotFoundError('Inquiry')
    return updated
  })
}
