// Priority backend features (catalog.md "Recomendaciones de priorización"):
// pagination, Redis events, categories + M:N, slug/SEO, item_type, soft-delete.
// Covers service wiring + event emission + repo SQL shape for the new tables.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/db.js', () => ({ pool: {}, withTenantTransaction: vi.fn() }))
vi.mock('../lib/events.js', () => ({ emitCatalogEvent: vi.fn() }))
vi.mock('../repositories/items.repository.js')

import {
  listItems, searchItems, createItem, updateItem, deleteItem,
  softDeleteItem, restoreItem, setItemStatus,
  listCategories, createCategory, updateCategory, deleteCategory,
  listItemsByCategory, assignCategory, unassignCategory, listItemCategories,
} from '../services/items.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { emitCatalogEvent } from '../lib/events.js'
import * as repo from '../repositories/items.repository.js'

const ctx = { appId: 'shop', tenantId: 't1', subTenantId: null }
const client = { query: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(client))
})

// ── Pagination ─────────────────────────────────────────────────────────
describe('pagination', () => {
  it('limit null → lista plana (back compat)', async () => {
    repo.findAll.mockResolvedValue([{ id: 'i1' }])
    const r = await listItems({ ...ctx, limit: null })
    expect(r).toEqual([{ id: 'i1' }])
    expect(repo.countAll).not.toHaveBeenCalled()
  })

  it('limit set → { data, total, limit, offset }', async () => {
    repo.findAll.mockResolvedValue([{ id: 'i1' }])
    repo.countAll.mockResolvedValue(42)
    const r = await listItems({ ...ctx, limit: 10, offset: 20 })
    expect(r).toEqual({ data: [{ id: 'i1' }], total: 42, limit: 10, offset: 20 })
    expect(repo.findAll).toHaveBeenCalledWith(client, expect.objectContaining({ limit: 10, offset: 20 }))
  })

  it('searchItems con limit → wrap con countSearch', async () => {
    repo.searchItems.mockResolvedValue([{ id: 'i1' }])
    repo.countSearch.mockResolvedValue(3)
    const r = await searchItems({ ...ctx, q: 'barro', limit: 5, offset: 0 })
    expect(r).toEqual({ data: [{ id: 'i1' }], total: 3, limit: 5, offset: 0 })
  })

  it('searchItems q vacío con limit → delega en listItems paginado', async () => {
    repo.findAll.mockResolvedValue([])
    repo.countAll.mockResolvedValue(0)
    const r = await searchItems({ ...ctx, q: '  ', limit: 5 })
    expect(r).toMatchObject({ total: 0, limit: 5 })
    expect(repo.searchItems).not.toHaveBeenCalled()
  })
})

// ── Events ─────────────────────────────────────────────────────────────
describe('domain events', () => {
  it('createItem emite catalog.item.created con scope', async () => {
    repo.create.mockResolvedValue({ id: 'i1', app_id: 'shop', tenant_id: 't1', status: 'draft', item_type: 'physical', slug: null })
    await createItem({ ...ctx, name: 'X' })
    expect(emitCatalogEvent).toHaveBeenCalledWith('catalog.item.created',
      expect.objectContaining({ itemId: 'i1', appId: 'shop', tenantId: 't1' }))
  })

  it('updateItem emite catalog.item.updated', async () => {
    repo.update.mockResolvedValue({ id: 'i1', app_id: 'shop', tenant_id: 't1', status: 'draft' })
    await updateItem({ ...ctx, id: 'i1', name: 'Y' })
    expect(emitCatalogEvent).toHaveBeenCalledWith('catalog.item.updated', expect.objectContaining({ itemId: 'i1' }))
  })

  it('deleteItem (hard) emite catalog.item.deleted hard:true', async () => {
    repo.remove.mockResolvedValue(true)
    await deleteItem({ ...ctx, id: 'i1' })
    expect(emitCatalogEvent).toHaveBeenCalledWith('catalog.item.deleted',
      expect.objectContaining({ itemId: 'i1', hard: true }))
  })

  it('setItemStatus published emite catalog.item.published', async () => {
    repo.findById
      .mockResolvedValueOnce({ id: 'i1', status: 'draft', version_number: 1, published_at: null, app_id: 'shop', tenant_id: 't1' })
      .mockResolvedValueOnce({ id: 'i1', status: 'published', app_id: 'shop', tenant_id: 't1' })
    repo.setStatus.mockResolvedValue({ id: 'i1', status: 'published' })
    await setItemStatus({ ...ctx, id: 'i1', status: 'published', actorUserId: 'u' })
    expect(emitCatalogEvent).toHaveBeenCalledWith('catalog.item.published', expect.objectContaining({ itemId: 'i1' }))
  })

  it('setItemStatus archived emite catalog.item.archived', async () => {
    repo.findById.mockResolvedValue({ id: 'i1', status: 'published', version_number: 2, app_id: 'shop', tenant_id: 't1' })
    repo.setStatus.mockResolvedValue({ id: 'i1', status: 'archived', app_id: 'shop', tenant_id: 't1' })
    await setItemStatus({ ...ctx, id: 'i1', status: 'archived', actorUserId: 'u' })
    expect(emitCatalogEvent).toHaveBeenCalledWith('catalog.item.archived', expect.objectContaining({ itemId: 'i1' }))
  })
})

// ── Soft delete / restore ──────────────────────────────────────────────
describe('soft delete + restore', () => {
  it('softDeleteItem ok → emite deleted hard:false', async () => {
    repo.softDelete.mockResolvedValue({ id: 'i1', app_id: 'shop', tenant_id: 't1', status: 'draft' })
    const r = await softDeleteItem({ ...ctx, id: 'i1' })
    expect(r.id).toBe('i1')
    expect(emitCatalogEvent).toHaveBeenCalledWith('catalog.item.deleted', expect.objectContaining({ hard: false }))
  })

  it('softDeleteItem inexistente → 404', async () => {
    repo.softDelete.mockResolvedValue(null)
    await expect(softDeleteItem({ ...ctx, id: 'ghost' })).rejects.toMatchObject({ statusCode: 404 })
  })

  it('restoreItem ok → emite updated', async () => {
    repo.restore.mockResolvedValue({ id: 'i1', app_id: 'shop', tenant_id: 't1', status: 'draft' })
    await restoreItem({ ...ctx, id: 'i1' })
    expect(emitCatalogEvent).toHaveBeenCalledWith('catalog.item.updated', expect.objectContaining({ itemId: 'i1' }))
  })

  it('restoreItem inexistente → 404', async () => {
    repo.restore.mockResolvedValue(null)
    await expect(restoreItem({ ...ctx, id: 'ghost' })).rejects.toMatchObject({ statusCode: 404 })
  })
})

// ── Categories service ─────────────────────────────────────────────────
describe('categories service', () => {
  it('createCategory delega a repo con scope', async () => {
    repo.createCategory.mockResolvedValue({ id: 'c1' })
    const r = await createCategory({ ...ctx, name: 'Bebidas', slug: 'bebidas' })
    expect(r).toEqual({ id: 'c1' })
    expect(repo.createCategory).toHaveBeenCalledWith(client, expect.objectContaining({
      appId: 'shop', tenantId: 't1', name: 'Bebidas', slug: 'bebidas',
    }))
  })

  it('listCategories delega', async () => {
    repo.listCategories.mockResolvedValue([{ id: 'c1' }])
    expect(await listCategories(ctx)).toEqual([{ id: 'c1' }])
  })

  it('updateCategory null → 404', async () => {
    repo.updateCategory.mockResolvedValue(null)
    await expect(updateCategory({ ...ctx, id: 'ghost', name: 'X' })).rejects.toMatchObject({ statusCode: 404 })
  })

  it('deleteCategory false → 404', async () => {
    repo.deleteCategory.mockResolvedValue(false)
    await expect(deleteCategory({ ...ctx, id: 'ghost' })).rejects.toMatchObject({ statusCode: 404 })
  })

  it('listItemsByCategory delega con activeOnly', async () => {
    repo.listItemsByCategory.mockResolvedValue([{ id: 'i1' }])
    await listItemsByCategory({ ...ctx, categoryId: 'c1', activeOnly: false })
    expect(repo.listItemsByCategory).toHaveBeenCalledWith(client, 'c1', { activeOnly: false })
  })
})

// ── Item ↔ category assignment ─────────────────────────────────────────
describe('item category assignment', () => {
  it('assignCategory: item + category existen → asigna y devuelve lista', async () => {
    repo.findById.mockResolvedValue({ id: 'i1' })
    repo.findCategoryById.mockResolvedValue({ id: 'c1' })
    repo.listItemCategories.mockResolvedValue([{ id: 'c1' }])
    const r = await assignCategory({ ...ctx, id: 'i1', categoryId: 'c1' })
    expect(r).toEqual([{ id: 'c1' }])
    expect(repo.assignCategory).toHaveBeenCalledWith(client, expect.objectContaining({ itemId: 'i1', categoryId: 'c1' }))
  })

  it('assignCategory: item no existe → 404', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(assignCategory({ ...ctx, id: 'ghost', categoryId: 'c1' })).rejects.toMatchObject({ statusCode: 404 })
  })

  it('assignCategory: category no existe → 404', async () => {
    repo.findById.mockResolvedValue({ id: 'i1' })
    repo.findCategoryById.mockResolvedValue(null)
    await expect(assignCategory({ ...ctx, id: 'i1', categoryId: 'ghost' })).rejects.toMatchObject({ statusCode: 404 })
  })

  it('unassignCategory false → 404', async () => {
    repo.unassignCategory.mockResolvedValue(false)
    await expect(unassignCategory({ ...ctx, id: 'i1', categoryId: 'c1' })).rejects.toMatchObject({ statusCode: 404 })
  })

  it('listItemCategories: item no existe → 404', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(listItemCategories({ ...ctx, id: 'ghost' })).rejects.toMatchObject({ statusCode: 404 })
  })
})
