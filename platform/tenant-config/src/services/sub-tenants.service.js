// sub-tenants service (#9). CRUD del segundo nivel de tenancy. Cada operación
// verifica que el tenant padre existe y escopa por (tenant_id), heredando el
// aislamiento (app_id, tenant_id). Emite tenant.config.updated en mutaciones
// para que los consumidores (shell, scheduler) re-resuelvan estructura.
import { withTransaction, pool } from '../lib/db.js'
import { publish as publishEvent } from '../lib/redis.js'
import * as subTenantsRepo from '../repositories/sub-tenants.repository.js'
import * as tenantsRepo from '../repositories/tenants.repository.js'
import * as auditRepo from '../repositories/audit.repository.js'
import { ConflictError, NotFoundError } from '@apphub/platform-sdk/errors'
import { logger } from '../lib/logger.js'

async function emit(type, payload) {
  try {
    await publishEvent({ type, payload })
  } catch (err) {
    logger.warn({ err, type }, `${type} publish failed (non-fatal)`)
  }
}

async function loadParent(client, tenantId) {
  const parent = await tenantsRepo.findById(client, tenantId)
  if (!parent) throw new NotFoundError('Tenant')
  return parent
}

export async function listSubTenants(tenantId) {
  return withTransaction(pool, async (client) => {
    await loadParent(client, tenantId)
    return subTenantsRepo.findByTenant(client, tenantId)
  })
}

export async function getSubTenant(tenantId, id) {
  return withTransaction(pool, async (client) => {
    await loadParent(client, tenantId)
    const sub = await subTenantsRepo.findById(client, tenantId, id)
    if (!sub) throw new NotFoundError('SubTenant')
    return sub
  })
}

export async function createSubTenant(tenantId, { displayName, slug }, actor) {
  let sub
  try {
    sub = await withTransaction(pool, async (client) => {
      const parent = await loadParent(client, tenantId)
      const created = await subTenantsRepo.create(client, {
        tenantId,
        appId: parent.app_id, // hereda el app_id del padre — nunca lo elige el caller
        displayName,
        slug,
      })
      await auditRepo.insert(client, {
        actorUserId: actor?.userId ?? null,
        actorRole:   actor?.role   ?? null,
        appId:       parent.app_id,
        tenantId,
        action:      'SUB_TENANT_CREATED',
        detail:      `Sub-tenant "${displayName}" (${slug})`,
        ip:          actor?.ip ?? null,
      })
      return created
    })
  } catch (err) {
    if (err.code === '23505') throw new ConflictError('slug already exists for this tenant')
    throw err
  }
  await emit('tenant.config.updated', { tenantId, appId: sub.app_id, change: 'sub_tenant_created' })
  return sub
}

export async function updateSubTenant(tenantId, id, fields, actor) {
  let sub
  try {
    sub = await withTransaction(pool, async (client) => {
      const parent = await loadParent(client, tenantId)
      const updated = await subTenantsRepo.update(client, tenantId, id, fields)
      if (!updated) throw new NotFoundError('SubTenant')
      const changedKeys = Object.keys(fields).filter((k) => fields[k] !== undefined)
      await auditRepo.insert(client, {
        actorUserId: actor?.userId ?? null,
        actorRole:   actor?.role   ?? null,
        appId:       parent.app_id,
        tenantId,
        action:      'SUB_TENANT_UPDATED',
        detail:      `Updated ${id}: ${changedKeys.join(', ')}`,
        ip:          actor?.ip ?? null,
      })
      return updated
    })
  } catch (err) {
    if (err.code === '23505') throw new ConflictError('slug already exists for this tenant')
    throw err
  }
  await emit('tenant.config.updated', { tenantId, appId: sub.app_id, change: 'sub_tenant_updated' })
  return sub
}

export async function deleteSubTenant(tenantId, id, actor) {
  const parentAppId = await withTransaction(pool, async (client) => {
    const parent = await loadParent(client, tenantId)
    const removed = await subTenantsRepo.remove(client, tenantId, id)
    if (!removed) throw new NotFoundError('SubTenant')
    await auditRepo.insert(client, {
      actorUserId: actor?.userId ?? null,
      actorRole:   actor?.role   ?? null,
      appId:       parent.app_id,
      tenantId,
      action:      'SUB_TENANT_DELETED',
      detail:      id,
      ip:          actor?.ip ?? null,
    })
    return parent.app_id
  })
  await emit('tenant.config.updated', { tenantId, appId: parentAppId, change: 'sub_tenant_deleted' })
  return { id, deleted: true }
}
