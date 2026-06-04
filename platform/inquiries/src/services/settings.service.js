import { withTenantTransaction } from '../lib/db.js'
import { ForbiddenError, ValidationError } from '@apphub/platform-sdk/errors'
import * as repo from '../repositories/settings.repository.js'

const ADMIN_ROLES = new Set(['owner', 'admin', 'staff', 'super_admin'])

function requireAdmin(identity) {
  if (!identity?.userId) throw new ForbiddenError()
  if (!ADMIN_ROLES.has(identity.role)) throw new ForbiddenError('Only admin/staff')
}

// Resuelve settings dentro de una transacción existente (RLS ya seteada
// por withTenantTransaction). Lanza ValidationError 422 si no hay row —
// el módulo no puede operar sin un contact_inbox_email configurado.
export async function resolveContactInbox(client, appId, tenantId) {
  const row = await repo.findByAppTenant(client, appId, tenantId)
  if (!row?.contact_inbox_email) {
    throw new ValidationError('contact inbox not configured for this tenant')
  }
  return row
}

// Admin endpoints: GET muestra el setting actual (o null si no hay), PUT
// upserta. RLS garantiza que cada admin solo ve/cambia el de su tenant.
export async function getForTenant(identity) {
  requireAdmin(identity)
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId ?? null, (c) =>
    repo.findByAppTenant(c, identity.appId, identity.tenantId),
  )
}

export async function upsertForTenant(identity, body) {
  requireAdmin(identity)
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId ?? null, (c) =>
    repo.upsert(c, {
      appId:             identity.appId,
      tenantId:          identity.tenantId,
      contactInboxEmail: body.contactInboxEmail,
      replyToEmail:      body.replyToEmail,
      userThanksSubject: body.userThanksSubject,
      userThanksBody:    body.userThanksBody,
      retentionDays:     body.retentionDays,
    }),
  )
}
