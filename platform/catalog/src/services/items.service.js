import { pool, withTenantTransaction } from '../lib/db.js'
import * as itemsRepo from '../repositories/items.repository.js'
import { NotFoundError, ConflictError, ValidationError } from '@apphub/platform-sdk/errors'

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

// ── Versioning (draft/published/archived) ──────────────────────────────

export async function setItemStatus({ appId, tenantId, subTenantId, id, status, actorUserId }) {
  if (!['draft', 'published', 'archived'].includes(status)) throw new ValidationError('invalid status')
  return withTenantTransaction(pool, appId, tenantId, subTenantId, async (client) => {
    const item = await itemsRepo.findById(client, id)
    if (!item) throw new NotFoundError('Item')
    const updated = await itemsRepo.setStatus(client, id, status)
    // On a publish transition, snapshot + bump version_number.
    if (status === 'published' && item.status !== 'published') {
      const next = (item.version_number ?? 1) + (item.published_at ? 1 : 0)
      await itemsRepo.publishVersion(client, id, next, item, actorUserId)
      return itemsRepo.findById(client, id)
    }
    return updated
  })
}

export async function listItemVersions({ appId, tenantId, subTenantId, id }) {
  return withTenantTransaction(pool, appId, tenantId, subTenantId, (client) =>
    itemsRepo.listVersions(client, id),
  )
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
  const statusIdx      = header.indexOf('status')
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
