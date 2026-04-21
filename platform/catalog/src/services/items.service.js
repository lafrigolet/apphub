import { pool, withTenantTransaction } from '../lib/db.js'
import * as itemsRepo from '../repositories/items.repository.js'
import { NotFoundError } from '@apphub/platform-sdk/errors'

export async function listItems({ appId, tenantId, subTenantId, activeOnly = true }) {
  return withTenantTransaction(pool, appId, tenantId, subTenantId, (client) =>
    itemsRepo.findAll(client, { activeOnly }),
  )
}

export async function getItem({ appId, tenantId, subTenantId, id }) {
  const item = await withTenantTransaction(pool, appId, tenantId, subTenantId, (client) =>
    itemsRepo.findById(client, id),
  )
  if (!item) throw new NotFoundError('Item')
  return item
}

export async function createItem({ appId, tenantId, subTenantId, name, description, priceCents, currency, category, metadata }) {
  return withTenantTransaction(pool, appId, tenantId, subTenantId, (client) =>
    itemsRepo.create(client, { appId, tenantId, subTenantId, name, description, priceCents, currency, category, metadata }),
  )
}

export async function updateItem({ appId, tenantId, subTenantId, id, ...fields }) {
  const item = await withTenantTransaction(pool, appId, tenantId, subTenantId, (client) =>
    itemsRepo.update(client, id, fields),
  )
  if (!item) throw new NotFoundError('Item')
  return item
}

export async function deleteItem({ appId, tenantId, subTenantId, id }) {
  const deleted = await withTenantTransaction(pool, appId, tenantId, subTenantId, (client) =>
    itemsRepo.remove(client, id),
  )
  if (!deleted) throw new NotFoundError('Item')
}
