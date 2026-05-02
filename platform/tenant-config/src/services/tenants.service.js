import { withTransaction, pool } from '../lib/db.js'
import * as tenantsRepo from '../repositories/tenants.repository.js'
import * as appsRepo from '../repositories/apps.repository.js'
import * as auditRepo from '../repositories/audit.repository.js'
import { ConflictError, NotFoundError } from '@apphub/platform-sdk/errors'
import { writeTenantNginxConfig, deleteTenantNginxConfig } from './nginx-config.service.js'
import { logger } from '../lib/logger.js'

export async function listTenants(appId) {
  return withTransaction(pool, (client) => tenantsRepo.findAll(client, appId))
}

export async function getTenant(id) {
  const tenant = await withTransaction(pool, (client) => tenantsRepo.findById(client, id))
  if (!tenant) throw new NotFoundError('Tenant')
  return tenant
}

export async function createTenant({ appId, displayName, subdomain }, actor) {
  let tenant
  try {
    tenant = await withTransaction(pool, async (client) => {
      const app = await appsRepo.findByAppId(client, appId)
      if (!app) throw new NotFoundError('App')
      const t = await tenantsRepo.create(client, { appId, displayName, subdomain })
      await auditRepo.insert(client, {
        actorUserId: actor?.userId ?? null,
        actorRole:   actor?.role   ?? null,
        appId,
        tenantId: t.id,
        action:   'TENANT_CREATED',
        detail:   `Tenant "${t.display_name}" created with subdomain ${t.subdomain}`,
        ip:       actor?.ip ?? null,
      })
      return t
    })
  } catch (err) {
    if (err.code === '23505') throw new ConflictError('subdomain already exists')
    if (err.code === '23503') throw new NotFoundError('App')
    throw err
  }

  // Best-effort NGINX provisioning. The tenant row is committed; if Redis is
  // down the operator can re-run the backfill (`backfillTenantNginxConfigs`
  // on next platform-core boot) without losing data.
  try {
    await writeTenantNginxConfig({ tenantId: tenant.id, subdomain: tenant.subdomain })
  } catch (err) {
    logger.warn({ err, tenantId: tenant.id }, 'Failed to publish tenant NGINX conf — tenant created but routing not provisioned')
  }
  return tenant
}

/**
 * Backfill: re-publish NGINX server blocks for every active tenant. Run
 * on platform-core boot so a fresh Redis (or one cleared during ops) ends
 * up with the right map without manual intervention. Idempotent.
 */
export async function backfillTenantNginxConfigs() {
  const tenants = await withTransaction(pool, (client) => tenantsRepo.findAllActive(client))
  let count = 0
  for (const t of tenants) {
    if (!t.subdomain) continue
    try {
      await writeTenantNginxConfig({ tenantId: t.id, subdomain: t.subdomain })
      count++
    } catch (err) {
      logger.warn({ err, tenantId: t.id }, 'backfill: failed to write tenant NGINX conf')
    }
  }
  logger.info({ count }, 'NGINX tenant configs backfilled')
  return count
}

/**
 * Public lookup: subdomain → { tenantId, appId }. The tenant-console-portal
 * uses this to derive the app context from the Host header before login,
 * so the LoginView can warn the user if their JWT belongs to a different
 * tenant than the subdomain they're visiting.
 */
export async function getTenantBySubdomain(subdomain) {
  const tenant = await withTransaction(pool, (client) => tenantsRepo.findBySubdomain(client, subdomain))
  if (!tenant) throw new NotFoundError('Tenant')
  return { tenantId: tenant.id, appId: tenant.app_id, displayName: tenant.display_name, status: tenant.status }
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
