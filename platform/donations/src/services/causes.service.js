import { withTenantTransaction } from '../lib/db.js'
import * as repo from '../repositories/causes.repository.js'
import { ForbiddenError, NotFoundError, ConflictError } from '@apphub/platform-sdk/errors'

const ADMIN_ROLES = new Set(['owner', 'admin', 'staff', 'super_admin'])

function ctxFromIdentity(identity) {
  return {
    appId:       identity.appId,
    tenantId:    identity.tenantId,
    subTenantId: identity.subTenantId ?? null,
    role:        identity.role,
  }
}

function requireAdmin(identity) {
  if (!identity?.userId) throw new ForbiddenError()
  if (!ADMIN_ROLES.has(identity.role)) throw new ForbiddenError('Only admin/staff can manage causes')
}

// Lectura pública — para el form de donación que pinta las causas
// activas. El caller pasa appId+tenantId explícito (no JWT).
export async function listPublicCauses({ appId, tenantId }) {
  return withTenantTransaction(appId, tenantId, null, (c) =>
    repo.list(c, { onlyActive: true }),
  )
}

export async function listAllCauses(identity) {
  requireAdmin(identity)
  const ctx = ctxFromIdentity(identity)
  return withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.list(c, { onlyActive: false }),
  )
}

export async function getCauseById(identity, id) {
  requireAdmin(identity)
  const ctx = ctxFromIdentity(identity)
  return withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const row = await repo.findById(c, id)
    if (!row) throw new NotFoundError('Cause')
    return row
  })
}

export async function createCause(identity, body) {
  requireAdmin(identity)
  const ctx = ctxFromIdentity(identity)
  return withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const existing = await repo.findByCode(c, ctx.appId, ctx.tenantId, body.code)
    if (existing) throw new ConflictError('Ya existe una causa con ese código')
    return repo.insert(c, { ...body, appId: ctx.appId, tenantId: ctx.tenantId, subTenantId: ctx.subTenantId })
  })
}

export async function updateCause(identity, id, patch) {
  requireAdmin(identity)
  const ctx = ctxFromIdentity(identity)
  return withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const updated = await repo.update(c, id, patch)
    if (!updated) throw new NotFoundError('Cause')
    return updated
  })
}

export async function deleteCause(identity, id) {
  requireAdmin(identity)
  const ctx = ctxFromIdentity(identity)
  return withTenantTransaction(ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const ok = await repo.softDelete(c, id)
    if (!ok) throw new NotFoundError('Cause')
  })
}
