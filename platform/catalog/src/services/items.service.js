import { pool, withTenantTransaction } from '../lib/db.js'
import * as itemsRepo from '../repositories/items.repository.js'
import { emitCatalogEvent } from '../lib/events.js'
import { NotFoundError, ValidationError } from '@apphub/platform-sdk/errors'

// Builds the event payload shared by item.* events. Scope fields first so
// consumers can route/filter without parsing the whole snapshot.
function itemEventPayload(item) {
  return {
    itemId: item.id,
    appId: item.app_id,
    tenantId: item.tenant_id,
    subTenantId: item.sub_tenant_id ?? null,
    status: item.status,
    itemType: item.item_type,
    slug: item.slug ?? null,
  }
}

// ── Listing + pagination ───────────────────────────────────────────────
// limit/offset are optional: when limit is null we return the full list (back
// compat) but always wrap reads with pagination meta when limit is supplied.
export async function listItems({ appId, tenantId, subTenantId, activeOnly = true, includeDeleted = false, limit = null, offset = 0 }) {
  return withTenantTransaction(pool, appId, tenantId, subTenantId, async (client) => {
    if (limit == null) return itemsRepo.findAll(client, { activeOnly, includeDeleted })
    const [data, total] = await Promise.all([
      itemsRepo.findAll(client, { activeOnly, includeDeleted, limit, offset }),
      itemsRepo.countAll(client, { activeOnly, includeDeleted }),
    ])
    return { data, total, limit, offset }
  })
}

export async function searchItems({ appId, tenantId, subTenantId, q, activeOnly = true, includeDeleted = false, limit = null, offset = 0 }) {
  const term = (q ?? '').trim()
  if (!term) return listItems({ appId, tenantId, subTenantId, activeOnly, includeDeleted, limit, offset })
  return withTenantTransaction(pool, appId, tenantId, subTenantId, async (client) => {
    if (limit == null) return itemsRepo.searchItems(client, { q: term, activeOnly, includeDeleted })
    const [data, total] = await Promise.all([
      itemsRepo.searchItems(client, { q: term, activeOnly, includeDeleted, limit, offset }),
      itemsRepo.countSearch(client, { q: term, activeOnly, includeDeleted }),
    ])
    return { data, total, limit, offset }
  })
}

export async function getItem({ appId, tenantId, subTenantId, id }) {
  const item = await withTenantTransaction(pool, appId, tenantId, subTenantId, (client) =>
    itemsRepo.findById(client, id),
  )
  if (!item) throw new NotFoundError('Item')
  return item
}

export async function createItem({ appId, tenantId, subTenantId, ...fields }) {
  const item = await withTenantTransaction(pool, appId, tenantId, subTenantId, (client) =>
    itemsRepo.create(client, { appId, tenantId, subTenantId, ...fields }),
  )
  await emitCatalogEvent('catalog.item.created', itemEventPayload(item))
  return item
}

export async function updateItem({ appId, tenantId, subTenantId, id, ...fields }) {
  const item = await withTenantTransaction(pool, appId, tenantId, subTenantId, (client) =>
    itemsRepo.update(client, id, fields),
  )
  if (!item) throw new NotFoundError('Item')
  await emitCatalogEvent('catalog.item.updated', itemEventPayload(item))
  return item
}

// Hard delete. Emits catalog.item.deleted.
export async function deleteItem({ appId, tenantId, subTenantId, id }) {
  const deleted = await withTenantTransaction(pool, appId, tenantId, subTenantId, (client) =>
    itemsRepo.remove(client, id),
  )
  if (!deleted) throw new NotFoundError('Item')
  await emitCatalogEvent('catalog.item.deleted', { itemId: id, appId, tenantId, hard: true })
}

// Soft delete (logical). Preferred over hard delete to preserve order refs.
export async function softDeleteItem({ appId, tenantId, subTenantId, id }) {
  const item = await withTenantTransaction(pool, appId, tenantId, subTenantId, (client) =>
    itemsRepo.softDelete(client, id),
  )
  if (!item) throw new NotFoundError('Item')
  await emitCatalogEvent('catalog.item.deleted', { ...itemEventPayload(item), hard: false })
  return item
}

export async function restoreItem({ appId, tenantId, subTenantId, id }) {
  const item = await withTenantTransaction(pool, appId, tenantId, subTenantId, (client) =>
    itemsRepo.restore(client, id),
  )
  if (!item) throw new NotFoundError('Item')
  await emitCatalogEvent('catalog.item.updated', itemEventPayload(item))
  return item
}

// ── Versioning (draft/published/archived) ──────────────────────────────

export async function setItemStatus({ appId, tenantId, subTenantId, id, status, actorUserId }) {
  if (!['draft', 'published', 'archived'].includes(status)) throw new ValidationError('invalid status')
  const result = await withTenantTransaction(pool, appId, tenantId, subTenantId, async (client) => {
    const item = await itemsRepo.findById(client, id)
    if (!item) throw new NotFoundError('Item')
    const updated = await itemsRepo.setStatus(client, id, status)
    // On a publish transition, snapshot + bump version_number.
    if (status === 'published' && item.status !== 'published') {
      const next = (item.version_number ?? 1) + (item.published_at ? 1 : 0)
      await itemsRepo.publishVersion(client, id, next, item, actorUserId)
      return { item: await itemsRepo.findById(client, id), transitioned: true, from: item.status }
    }
    return { item: updated, transitioned: item.status !== status, from: item.status }
  })
  // Emit a status-specific event so consumers can react narrowly.
  if (status === 'published' && result.from !== 'published') {
    await emitCatalogEvent('catalog.item.published', itemEventPayload(result.item))
  } else if (status === 'archived' && result.from !== 'archived') {
    await emitCatalogEvent('catalog.item.archived', itemEventPayload(result.item))
  } else if (result.transitioned) {
    await emitCatalogEvent('catalog.item.updated', itemEventPayload(result.item))
  }
  return result.item
}

export async function listItemVersions({ appId, tenantId, subTenantId, id }) {
  return withTenantTransaction(pool, appId, tenantId, subTenantId, (client) =>
    itemsRepo.listVersions(client, id),
  )
}

// ── Categories ─────────────────────────────────────────────────────────

export async function listCategories({ appId, tenantId, subTenantId }) {
  return withTenantTransaction(pool, appId, tenantId, subTenantId, (client) =>
    itemsRepo.listCategories(client),
  )
}

export async function createCategory({ appId, tenantId, subTenantId, ...fields }) {
  return withTenantTransaction(pool, appId, tenantId, subTenantId, (client) =>
    itemsRepo.createCategory(client, { appId, tenantId, subTenantId, ...fields }),
  )
}

export async function updateCategory({ appId, tenantId, subTenantId, id, ...fields }) {
  const cat = await withTenantTransaction(pool, appId, tenantId, subTenantId, (client) =>
    itemsRepo.updateCategory(client, id, fields),
  )
  if (!cat) throw new NotFoundError('Category')
  return cat
}

export async function deleteCategory({ appId, tenantId, subTenantId, id }) {
  const ok = await withTenantTransaction(pool, appId, tenantId, subTenantId, (client) =>
    itemsRepo.deleteCategory(client, id),
  )
  if (!ok) throw new NotFoundError('Category')
}

export async function listItemsByCategory({ appId, tenantId, subTenantId, categoryId, activeOnly = true }) {
  return withTenantTransaction(pool, appId, tenantId, subTenantId, (client) =>
    itemsRepo.listItemsByCategory(client, categoryId, { activeOnly }),
  )
}

// ── Item ↔ category assignment ─────────────────────────────────────────

export async function listItemCategories({ appId, tenantId, subTenantId, id }) {
  return withTenantTransaction(pool, appId, tenantId, subTenantId, async (client) => {
    const item = await itemsRepo.findById(client, id)
    if (!item) throw new NotFoundError('Item')
    return itemsRepo.listItemCategories(client, id)
  })
}

export async function assignCategory({ appId, tenantId, subTenantId, id, categoryId }) {
  return withTenantTransaction(pool, appId, tenantId, subTenantId, async (client) => {
    const item = await itemsRepo.findById(client, id)
    if (!item) throw new NotFoundError('Item')
    const cat = await itemsRepo.findCategoryById(client, categoryId)
    if (!cat) throw new NotFoundError('Category')
    await itemsRepo.assignCategory(client, { appId, tenantId, itemId: id, categoryId })
    return itemsRepo.listItemCategories(client, id)
  })
}

export async function unassignCategory({ appId, tenantId, subTenantId, id, categoryId }) {
  const ok = await withTenantTransaction(pool, appId, tenantId, subTenantId, (client) =>
    itemsRepo.unassignCategory(client, { itemId: id, categoryId }),
  )
  if (!ok) throw new NotFoundError('Assignment')
}

// ── Image gallery ──────────────────────────────────────────────────────

export async function listImages({ appId, tenantId, subTenantId, id }) {
  return withTenantTransaction(pool, appId, tenantId, subTenantId, (client) =>
    itemsRepo.listImages(client, id),
  )
}

export async function attachImage({ appId, tenantId, subTenantId, id, objectId, altText, displayOrder }) {
  return withTenantTransaction(pool, appId, tenantId, subTenantId, async (client) => {
    const item = await itemsRepo.findById(client, id)
    if (!item) throw new NotFoundError('Item')
    return itemsRepo.insertImage(client, { itemId: id, objectId, altText, displayOrder })
  })
}

export async function detachImage({ appId, tenantId, subTenantId, imageId }) {
  const ok = await withTenantTransaction(pool, appId, tenantId, subTenantId, (client) =>
    itemsRepo.deleteImage(client, imageId),
  )
  if (!ok) throw new NotFoundError('Image')
}

// ── CSV import / export ────────────────────────────────────────────────

const CSV_COLUMNS = ['id', 'name', 'description', 'price_cents', 'currency', 'category', 'status', 'active']

function escapeCsv(v) {
  if (v == null) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function exportCsv({ appId, tenantId, subTenantId }) {
  const items = await withTenantTransaction(pool, appId, tenantId, subTenantId, (client) =>
    itemsRepo.findAll(client, { activeOnly: false }),
  )
  const lines = [CSV_COLUMNS.join(',')]
  for (const it of items) {
    lines.push(CSV_COLUMNS.map((c) => escapeCsv(it[c])).join(','))
  }
  return lines.join('\n') + '\n'
}

// Tiny CSV parser: handles "quoted, with commas", embedded newlines and ""
// escaped quotes. Falls back to a row count error rather than a partial
// import on malformed input.
function parseCsv(text) {
  const rows = []
  let row = []
  let cur = ''
  let inQuoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++ }
        else inQuoted = false
      } else cur += ch
    } else if (ch === '"') {
      inQuoted = true
    } else if (ch === ',') {
      row.push(cur); cur = ''
    } else if (ch === '\n') {
      row.push(cur); rows.push(row); row = []; cur = ''
    } else if (ch === '\r') {
      // skip
    } else cur += ch
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row) }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ''))
}

export async function importCsv({ appId, tenantId, subTenantId, csv }) {
  const rows = parseCsv(csv)
  if (rows.length < 2) throw new ValidationError('csv requires a header row + at least 1 data row')
  const header = rows[0].map((h) => h.trim().toLowerCase())
  const required = ['name', 'price_cents']
  for (const r of required) {
    if (!header.includes(r)) throw new ValidationError(`csv header missing required column: ${r}`)
  }
  const idIdx          = header.indexOf('id')
  const nameIdx        = header.indexOf('name')
  const descIdx        = header.indexOf('description')
  const priceIdx       = header.indexOf('price_cents')
  const currencyIdx    = header.indexOf('currency')
  const categoryIdx    = header.indexOf('category')
  const activeIdx      = header.indexOf('active')

  let inserted = 0, updated = 0, errors = 0
  await withTenantTransaction(pool, appId, tenantId, subTenantId, async (client) => {
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r]
      try {
        const id   = idIdx          >= 0 ? row[idIdx]?.trim()                         : null
        const fields = {
          name:        row[nameIdx]?.trim(),
          description: descIdx     >= 0 ? row[descIdx]                                : undefined,
          priceCents:  Number(row[priceIdx]),
          currency:    currencyIdx >= 0 ? row[currencyIdx]?.trim().toLowerCase()      : 'eur',
          category:    categoryIdx >= 0 ? row[categoryIdx]                            : undefined,
          metadata:    {},
          active:      activeIdx   >= 0 ? row[activeIdx]?.trim().toLowerCase() === 'true' : true,
        }
        if (id) {
          const existing = await itemsRepo.findById(client, id)
          if (existing) {
            await itemsRepo.update(client, id, fields)
            updated++
            continue
          }
        }
        await itemsRepo.create(client, { appId, tenantId, subTenantId, ...fields })
        inserted++
      } catch (_err) {
        errors++
      }
    }
  })
  return { rowsTotal: rows.length - 1, inserted, updated, errors }
}
