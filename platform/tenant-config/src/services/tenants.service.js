import { withTransaction, pool } from '../lib/db.js'
import * as tenantsRepo from '../repositories/tenants.repository.js'
import * as appsRepo from '../repositories/apps.repository.js'
import * as auditRepo from '../repositories/audit.repository.js'
import { ConflictError, NotFoundError } from '@apphub/platform-sdk/errors'

export async function listTenants(appId) {
  return withTransaction(pool, (client) => tenantsRepo.findAll(client, appId))
}

export async function getTenant(id) {
  const tenant = await withTransaction(pool, (client) => tenantsRepo.findById(client, id))
  if (!tenant) throw new NotFoundError('Tenant')
  return tenant
}

export async function createTenant({ appId, displayName, subdomain }, actor) {
  try {
    return await withTransaction(pool, async (client) => {
      const app = await appsRepo.findByAppId(client, appId)
      if (!app) throw new NotFoundError('App')
      const tenant = await tenantsRepo.create(client, { appId, displayName, subdomain })
      await auditRepo.insert(client, {
        actorUserId: actor?.userId ?? null,
        actorRole:   actor?.role   ?? null,
        appId,
        tenantId: tenant.id,
        action:   'TENANT_CREATED',
        detail:   `Tenant "${tenant.display_name}" created with subdomain ${tenant.subdomain}`,
        ip:       actor?.ip ?? null,
      })
      return tenant
    })
  } catch (err) {
    if (err.code === '23505') throw new ConflictError('subdomain already exists')
    if (err.code === '23503') throw new NotFoundError('App')
    throw err
  }
}

export async function setTenantStatus(id, { status, reason }, actor) {
  return withTransaction(pool, async (client) => {
    const tenant = await tenantsRepo.updateStatus(client, id, {
      status,
      suspendReason: status === 'suspended' ? reason ?? null : null,
      archivedAt:    status === 'archived'  ? new Date()     : null,
    })
    if (!tenant) throw new NotFoundError('Tenant')
    const actionByStatus = {
      suspended: 'TENANT_SUSPENDED',
      archived:  'TENANT_ARCHIVED',
      active:    'TENANT_REACTIVATED',
    }
    await auditRepo.insert(client, {
      actorUserId: actor?.userId ?? null,
      actorRole:   actor?.role   ?? null,
      appId:       tenant.app_id,
      tenantId:    tenant.id,
      action:      actionByStatus[status] ?? 'TENANT_STATUS_CHANGED',
      detail:      reason ?? null,
      ip:          actor?.ip ?? null,
    })
    return tenant
  })
}

export async function updateTenant(id, fields, actor) {
  return withTransaction(pool, async (client) => {
    const tenant = await tenantsRepo.update(client, id, fields)
    if (!tenant) throw new NotFoundError('Tenant')
    const changedKeys = Object.keys(fields).filter((k) => fields[k] !== undefined)
    await auditRepo.insert(client, {
      actorUserId: actor?.userId ?? null,
      actorRole:   actor?.role   ?? null,
      appId:       tenant.app_id,
      tenantId:    tenant.id,
      action:      'TENANT_UPDATED',
      detail:      `Updated: ${changedKeys.join(', ')}`,
      ip:          actor?.ip ?? null,
    })
    return tenant
  })
}
