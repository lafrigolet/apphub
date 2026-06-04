import { pool, withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import { logger } from '../lib/logger.js'
import * as repo from '../repositories/menu.repository.js'
import { NotFoundError, ValidationError } from '../utils/errors.js'

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

export async function updateMenu(ctx, id, patch) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const updated = await repo.updateMenu(client, ctx.appId, ctx.tenantId, id, patch)
    if (!updated) throw new NotFoundError('menu')
    return updated
  })
}

export async function deleteMenu(ctx, id) {
  const deleted = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.softDeleteMenu(client, ctx.appId, ctx.tenantId, id),
  )
  if (!deleted) throw new NotFoundError('menu')
  return { id, deleted: true }
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

export async function updateCategory(ctx, id, patch) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const updated = await repo.updateCategory(client, ctx.appId, ctx.tenantId, id, patch)
    if (!updated) throw new NotFoundError('menu category')
    return updated
  })
}

export async function deleteCategory(ctx, id) {
  const deleted = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.softDeleteCategory(client, ctx.appId, ctx.tenantId, id),
  )
  if (!deleted) throw new NotFoundError('menu category')
  return { id, deleted: true }
}

export async function createItem(ctx, body) {
  const item = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.insertItem(client, { ...body, appId: ctx.appId, tenantId: ctx.tenantId }),
  )
  await publish({
    type: 'menu.item.created',
    payload: { appId: ctx.appId, tenantId: ctx.tenantId, itemId: item.id, sku: item.sku },
  })
  return item
}

export async function updateItem(ctx, id, patch) {
  const updated = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.updateItem(client, ctx.appId, ctx.tenantId, id, patch),
  )
  if (!updated) throw new NotFoundError('menu item')
  await publish({
    type: 'menu.item.updated',
    payload: { appId: ctx.appId, tenantId: ctx.tenantId, itemId: id, sku: updated.sku },
  })
  return updated
}

export async function deleteItem(ctx, id) {
  const deleted = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.softDeleteItem(client, ctx.appId, ctx.tenantId, id),
  )
  if (!deleted) throw new NotFoundError('menu item')
  await publish({
    type: 'menu.item.deleted',
    payload: { appId: ctx.appId, tenantId: ctx.tenantId, itemId: id, sku: deleted.sku },
  })
  return { id, deleted: true }
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

export async function listAvailabilityWindows(ctx, filter = {}) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.listAvailabilityWindows(client, ctx.appId, ctx.tenantId, filter),
  )
}

export async function updateAvailabilityWindow(ctx, id, patch) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const updated = await repo.updateAvailabilityWindow(client, ctx.appId, ctx.tenantId, id, patch)
    if (!updated) throw new NotFoundError('availability window')
    return updated
  })
}

export async function deleteAvailabilityWindow(ctx, id) {
  const deleted = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.deleteAvailabilityWindow(client, ctx.appId, ctx.tenantId, id),
  )
  if (!deleted) throw new NotFoundError('availability window')
  return { id, deleted: true }
}

// Evaluates availability windows in real time and returns only the items
// visible at the requested moment (defaults to "now" in UTC). `at` is an
// optional ISO timestamp used by tests / explicit queries.
export async function listItemsAvailableNow(ctx, menuId, at) {
  const now = at ? new Date(at) : new Date()
  if (Number.isNaN(now.getTime())) throw new ValidationError('invalid "at" timestamp')
  const dow = now.getUTCDay() // 0=Sun..6=Sat — matches days_of_week convention
  const minuteOfDay = now.getUTCHours() * 60 + now.getUTCMinutes()
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const menu = await repo.findMenuById(client, ctx.appId, ctx.tenantId, menuId)
    if (!menu) throw new NotFoundError('menu')
    return repo.listItemsAvailableNow(client, ctx.appId, ctx.tenantId, menuId, dow, minuteOfDay)
  })
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
