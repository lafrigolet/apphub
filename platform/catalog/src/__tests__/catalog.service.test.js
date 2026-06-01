// items.service — catalogo de productos plataforma.
// Contrato (foco en lo no trivial):
//   - getItem/updateItem/deleteItem: lookup → NotFoundError si null.
//   - setItemStatus:
//       · Status no permitido → ValidationError.
//       · NotFound si el item no existe.
//       · Transition a 'published' SNAPSHOTeará una versión nueva (publishVersion).
//       · Si el item ya está 'published' (re-publish), version_number SE incrementa,
//         pero la primera publicación NO incrementa (next = current+0 en cero-published_at).
//   - exportCsv: header + escape de coma/comilla/newline (valores entre comillas con "" doblada).
//   - importCsv:
//       · Requiere header + ≥1 data row (else ValidationError).
//       · Required columns: name, price_cents (else ValidationError).
//       · id en row + existing → update; id sin match (o sin id) → create.
//       · Fila con error individual NO aborta el batch — incrementa errors counter.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/db.js', () => ({ pool: {}, withTenantTransaction: vi.fn() }))
vi.mock('../repositories/items.repository.js')

import {
  listItems, getItem, createItem, updateItem, deleteItem, setItemStatus, exportCsv, importCsv,
} from '../services/items.service.js'
import { withTenantTransaction } from '../lib/db.js'
import * as repo from '../repositories/items.repository.js'

const ctx = {
  appId: 'aikikan',
  tenantId: '22222222-2222-2222-2222-222222222222',
  subTenantId: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn({}))
})

// ── happy-path delegations ───────────────────────────────────────────

describe('happy paths', () => {
  it('listItems delega a repo.findAll con activeOnly', async () => {
    repo.findAll.mockResolvedValue([{ id: 'i1' }])
    const r = await listItems({ ...ctx, activeOnly: true })
    expect(r).toEqual([{ id: 'i1' }])
    expect(repo.findAll).toHaveBeenCalledWith(expect.anything(), { activeOnly: true })
  })

  it('createItem delega a repo.create con scope + fields', async () => {
    repo.create.mockResolvedValue({ id: 'i1', name: 'Jarra' })
    const r = await createItem({ ...ctx, name: 'Jarra', priceCents: 1500, currency: 'eur' })
    expect(r).toEqual({ id: 'i1', name: 'Jarra' })
    expect(repo.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      appId: ctx.appId, tenantId: ctx.tenantId, name: 'Jarra', priceCents: 1500,
    }))
  })

  it('updateItem happy → devuelve item actualizado', async () => {
    repo.update.mockResolvedValue({ id: 'i1', name: 'New' })
    const r = await updateItem({ ...ctx, id: 'i1', name: 'New' })
    expect(r).toEqual({ id: 'i1', name: 'New' })
    expect(repo.update).toHaveBeenCalledWith(expect.anything(), 'i1', { name: 'New' })
  })

  it('deleteItem happy → resuelve sin error', async () => {
    repo.remove.mockResolvedValue(true)
    await expect(deleteItem({ ...ctx, id: 'i1' })).resolves.toBeUndefined()
  })
})

// ── NotFound 404 ─────────────────────────────────────────────────────

describe('NotFoundError 404', () => {
  it('getItem: existe → devuelve el item (rama no-404)', async () => {
    repo.findById.mockResolvedValue({ id: 'i1', name: 'Jarra' })
    const r = await getItem({ ...ctx, id: 'i1' })
    expect(r).toEqual({ id: 'i1', name: 'Jarra' })
  })
  it('getItem: null → 404', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(getItem({ ...ctx, id: 'ghost' })).rejects.toMatchObject({ statusCode: 404 })
  })
  it('updateItem: null → 404', async () => {
    repo.update.mockResolvedValue(null)
    await expect(updateItem({ ...ctx, id: 'ghost', name: 'x' })).rejects.toMatchObject({ statusCode: 404 })
  })
  it('deleteItem: deleted=false → 404', async () => {
    repo.remove.mockResolvedValue(false)
    await expect(deleteItem({ ...ctx, id: 'ghost' })).rejects.toMatchObject({ statusCode: 404 })
  })
})

// ── setItemStatus ────────────────────────────────────────────────────

describe('setItemStatus', () => {
  it('status no permitido → ValidationError', async () => {
    await expect(setItemStatus({ ...ctx, id: 'i1', status: 'banned', actorUserId: 'u' }))
      .rejects.toMatchObject({ statusCode: 422 })
  })

  it('item no existe → NotFoundError', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(setItemStatus({ ...ctx, id: 'ghost', status: 'published', actorUserId: 'u' }))
      .rejects.toMatchObject({ statusCode: 404 })
  })

  it('happy: draft → published por 1ª vez NO incrementa version_number (next=1+0=1)', async () => {
    repo.findById
      .mockResolvedValueOnce({ id: 'i1', status: 'draft', version_number: 1, published_at: null })
      .mockResolvedValueOnce({ id: 'i1', status: 'published', version_number: 1 })
    repo.setStatus.mockResolvedValue({ id: 'i1', status: 'published' })
    const r = await setItemStatus({ ...ctx, id: 'i1', status: 'published', actorUserId: 'u' })
    expect(r.status).toBe('published')
    expect(repo.publishVersion).toHaveBeenCalledWith(expect.anything(), 'i1', 1, expect.any(Object), 'u')
  })

  it('happy: re-publish (ya tenía published_at) SÍ incrementa version_number', async () => {
    repo.findById
      .mockResolvedValueOnce({ id: 'i1', status: 'draft', version_number: 3, published_at: '2026-01-01' })
      .mockResolvedValueOnce({ id: 'i1', status: 'published' })
    repo.setStatus.mockResolvedValue({ id: 'i1', status: 'published' })
    await setItemStatus({ ...ctx, id: 'i1', status: 'published', actorUserId: 'u' })
    expect(repo.publishVersion).toHaveBeenCalledWith(expect.anything(), 'i1', 4, expect.any(Object), 'u')
  })

  it('publish con version_number nullish → usa default 1 (?? 1)', async () => {
    repo.findById
      .mockResolvedValueOnce({ id: 'i1', status: 'draft', published_at: null })  // sin version_number
      .mockResolvedValueOnce({ id: 'i1', status: 'published', version_number: 1 })
    repo.setStatus.mockResolvedValue({ id: 'i1', status: 'published' })
    await setItemStatus({ ...ctx, id: 'i1', status: 'published', actorUserId: 'u' })
    expect(repo.publishVersion).toHaveBeenCalledWith(expect.anything(), 'i1', 1, expect.any(Object), 'u')
  })

  it('transition published → archived NO llama publishVersion', async () => {
    repo.findById.mockResolvedValue({ id: 'i1', status: 'published', version_number: 5 })
    repo.setStatus.mockResolvedValue({ id: 'i1', status: 'archived' })
    await setItemStatus({ ...ctx, id: 'i1', status: 'archived', actorUserId: 'u' })
    expect(repo.publishVersion).not.toHaveBeenCalled()
  })

  it('transition published → published (no cambio) NO llama publishVersion', async () => {
    repo.findById.mockResolvedValue({ id: 'i1', status: 'published', version_number: 2 })
    repo.setStatus.mockResolvedValue({ id: 'i1', status: 'published' })
    await setItemStatus({ ...ctx, id: 'i1', status: 'published', actorUserId: 'u' })
    expect(repo.publishVersion).not.toHaveBeenCalled()
  })
})

// ── exportCsv ────────────────────────────────────────────────────────

describe('exportCsv', () => {
  it('emite header + escape de comas y comillas', async () => {
    repo.findAll.mockResolvedValue([
      { id: 'i1', name: 'Té, verde', description: 'Con "azúcar"', price_cents: 350, currency: 'eur', category: 'bebidas', status: 'published', active: true },
      { id: 'i2', name: 'Salto\nde linea', price_cents: 100, currency: 'eur', status: 'draft', active: true },
    ])
    const csv = await exportCsv(ctx)
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe('id,name,description,price_cents,currency,category,status,active')
    expect(lines[1]).toContain('"Té, verde"')
    expect(lines[1]).toContain('"Con ""azúcar"""')
    // newline embebido SE PERSISTE como literal "\n" porque la línea siguiente
    // del CSV emitido también lo lleva entre comillas
    expect(csv).toContain('"Salto\nde linea"')
  })

  it('listado vacío → solo el header', async () => {
    repo.findAll.mockResolvedValue([])
    const csv = await exportCsv(ctx)
    expect(csv.trim()).toBe('id,name,description,price_cents,currency,category,status,active')
  })
})

// ── importCsv ────────────────────────────────────────────────────────

describe('importCsv', () => {
  it('header faltante required column → ValidationError', async () => {
    await expect(importCsv({ ...ctx, csv: 'name,description\nfoo,bar' }))
      .rejects.toMatchObject({ statusCode: 422, message: expect.stringContaining('price_cents') })
  })

  it('< 2 rows → ValidationError', async () => {
    await expect(importCsv({ ...ctx, csv: 'name,price_cents' }))
      .rejects.toMatchObject({ statusCode: 422, message: expect.stringContaining('header') })
  })

  it('id presente + existing → update; id ausente → create', async () => {
    repo.findById.mockResolvedValueOnce({ id: 'i1' })  // existing
    const csv = 'id,name,price_cents,currency\ni1,Foo,500,EUR\n,Bar,100,EUR'
    const r = await importCsv({ ...ctx, csv })
    expect(repo.update).toHaveBeenCalledWith(expect.anything(), 'i1', expect.objectContaining({
      name: 'Foo', priceCents: 500, currency: 'eur',
    }))
    expect(repo.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      name: 'Bar', priceCents: 100,
    }))
    expect(r).toMatchObject({ rowsTotal: 2, inserted: 1, updated: 1, errors: 0 })
  })

  it('id presente PERO no existe → create (fallback)', async () => {
    repo.findById.mockResolvedValue(null)
    const csv = 'id,name,price_cents\nghost,Foo,500'
    const r = await importCsv({ ...ctx, csv })
    expect(repo.update).not.toHaveBeenCalled()
    expect(repo.create).toHaveBeenCalled()
    expect(r.inserted).toBe(1)
  })

  it('row que lanza NO aborta el batch — incrementa errors', async () => {
    repo.create.mockRejectedValueOnce(new Error('FK violation'))
                .mockResolvedValueOnce({ id: 'i2' })
    const csv = 'name,price_cents\nbad,500\ngood,100'
    const r = await importCsv({ ...ctx, csv })
    expect(r).toMatchObject({ rowsTotal: 2, inserted: 1, errors: 1 })
  })

  it('CSV con CRLF (\\r\\n) — ignora el \\r al parsear', async () => {
    repo.create.mockResolvedValue({ id: 'i1' })
    const csv = 'name,price_cents\r\nJarra,500\r\n'
    const r = await importCsv({ ...ctx, csv })
    expect(r).toMatchObject({ rowsTotal: 1, inserted: 1 })
    expect(repo.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      name: 'Jarra', priceCents: 500,
    }))
  })

  it('CSV con comillas dobladas + coma embebida se parsea correctamente', async () => {
    const csv = 'name,price_cents\n"Té, con ""azúcar""",250'
    await importCsv({ ...ctx, csv })
    expect(repo.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      name: 'Té, con "azúcar"', priceCents: 250,
    }))
  })

  it('CSV con TODAS las columnas opcionales (description/category/active) → ramas truthy', async () => {
    repo.create.mockResolvedValue({ id: 'i1' })
    const csv = 'name,description,price_cents,currency,category,active\nJarra,Una jarra,500,USD,menaje,false'
    const r = await importCsv({ ...ctx, csv })
    expect(r).toMatchObject({ rowsTotal: 1, inserted: 1 })
    expect(repo.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      name: 'Jarra', description: 'Una jarra', priceCents: 500,
      currency: 'usd', category: 'menaje', active: false,
    }))
  })

  it('CSV con fila final de una sola columna NO vacía → la conserva (parseCsv filter)', async () => {
    // 'orphan' es una fila de 1 sola celda no vacía → pasa el filtro
    // (r.length===1 && r[0]!==''), se trata como data row y falla la
    // conversión (sin price) → cuenta como error, no aborta el batch.
    const csv = 'name,price_cents\nJarra,500\norphan'
    repo.create.mockResolvedValue({ id: 'i1' })
    const r = await importCsv({ ...ctx, csv })
    expect(r.rowsTotal).toBe(2)
  })
})
