import { withTransaction, pool } from '../lib/db.js'
import * as tenantsRepo from '../repositories/tenants.repository.js'
import * as appsRepo from '../repositories/apps.repository.js'
import { ConflictError, NotFoundError } from '@apphub/platform-sdk/errors'

export async function listTenants(appId) {
  return withTransaction(pool, (client) => tenantsRepo.findAll(client, appId))
}

export async function getTenant(id) {
  const tenant = await withTransaction(pool, (client) => tenantsRepo.findById(client, id))
  if (!tenant) throw new NotFoundError('Tenant')
  return tenant
}

export async function createTenant({ appId, displayName, subdomain }) {
  await withTransaction(pool, async (client) => {
    const app = await appsRepo.findByAppId(client, appId)
    if (!app) throw new NotFoundError('App')
  })
  try {
    return await withTransaction(pool, (client) =>
      tenantsRepo.create(client, { appId, displayName, subdomain }),
    )
  } catch (err) {
    if (err.code === '23505') throw new ConflictError('subdomain already exists')
    if (err.code === '23503') throw new NotFoundError('App')
    throw err
  }
}

export async function setTenantStatus(id, status) {
  const tenant = await withTransaction(pool, (client) => tenantsRepo.updateStatus(client, id, status))
  if (!tenant) throw new NotFoundError('Tenant')
  return tenant
}
