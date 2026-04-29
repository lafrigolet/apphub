import { pool, withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import { logger } from '../lib/logger.js'
import * as repo from '../repositories/menu.repository.js'
import { NotFoundError } from '../utils/errors.js'

export async function createMenu(ctx, body) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const menu = await repo.insertMenu(client, { ...body, appId: ctx.appId, tenantId: ctx.tenantId, subTenantId: ctx.subTenantId })
    return menu
  })
}

export async function listMenus(ctx) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.listMenus(client, ctx.appId, ctx.tenantId),
  )
}

export async function getMenu(ctx, id) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const menu = await repo.findMenuById(client, ctx.appId, ctx.tenantId, id)
    if (!menu) throw new NotFoundError('menu')
    const categories = await repo.listCategoriesByMenu(client, ctx.appId, ctx.tenantId, id)
    const withItems  = await Promise.all(categories.map(async (c) => ({
      ...c,
      items: await repo.listItemsByCategory(client, ctx.appId, ctx.tenantId, c.id),
    })))
    return { ...menu, categories: withItems }
  })
}

export async function listAvailableItems(ctx, menuId) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.listAvailableItems(client, ctx.appId, ctx.tenantId, menuId),
  )
}

export async function createCategory(ctx, body) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.insertCategory(client, { ...body, appId: ctx.appId, tenantId: ctx.tenantId }),
  )
}

export async function createItem(ctx, body) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.insertItem(client, { ...body, appId: ctx.appId, tenantId: ctx.tenantId }),
  )
}

export async function updateItem(ctx, id, patch) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const updated = await repo.updateItem(client, ctx.appId, ctx.tenantId, id, patch)
    if (!updated) throw new NotFoundError('menu item')
    return updated
  })
}

export async function eightySixItem(ctx, id) {
  const item = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.setEightySixed(client, ctx.appId, ctx.tenantId, id, true),
  )
  if (!item) throw new NotFoundError('menu item')
  await publish({
    type: 'menu.item.eighty_sixed',
    payload: { appId: ctx.appId, tenantId: ctx.tenantId, itemId: id, sku: item.sku },
  })
  return item
}

export async function unEightySixItem(ctx, id) {
  const item = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.setEightySixed(client, ctx.appId, ctx.tenantId, id, false),
  )
  if (!item) throw new NotFoundError('menu item')
  await publish({
    type: 'menu.item.restored',
    payload: { appId: ctx.appId, tenantId: ctx.tenantId, itemId: id, sku: item.sku },
  })
  return item
}

export async function createAvailabilityWindow(ctx, body) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.insertAvailabilityWindow(client, { ...body, appId: ctx.appId, tenantId: ctx.tenantId }),
  )
}

export async function publishMenu(ctx, id) {
  const menu = await getMenu(ctx, id)
  await publish({
    type: 'menu.published',
    payload: { appId: ctx.appId, tenantId: ctx.tenantId, menuId: id, name: menu.name },
  })
  return menu
}

export { logger }
