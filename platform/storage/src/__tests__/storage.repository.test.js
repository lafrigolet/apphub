// storage.repository — SQL shape de platform_storage.objects.
// Valida proyección de columnas, params parametrizados (anti-injection),
// COALESCE de defaults, filtros opcionales de listByTenant y stamping de
// markUploaded / softDelete.
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/storage.repository.js'

function mockClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

const APP = 'yoga'
const TEN = 't1'

describe('insert', () => {
  const o = {
    subTenantId: 'st1', ownerUserId: 'u1', kind: 'menu_photo',
    bucket: 'apphub', key: 'k', filename: 'f.png', contentType: 'image/png',
    sizeBytes: 500, retentionUntil: '2030-01-01', status: 'pending', metadata: { a: 1 },
  }

  it('INSERT en platform_storage.objects con 13 params en orden', async () => {
    const c = mockClient([{ id: 'o1' }])
    const r = await repo.insert(c, APP, TEN, o)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_storage\.objects/)
    expect(sql).toMatch(/RETURNING \*/)
    expect(params).toEqual([
      APP, TEN, 'st1', 'u1', 'menu_photo', 'apphub', 'k',
      'f.png', 'image/png', 500, '2030-01-01', 'pending', { a: 1 },
    ])
    expect(r).toEqual({ id: 'o1' })
  })

  it('aplica defaults cuando faltan campos opcionales', async () => {
    const c = mockClient([{ id: 'o1' }])
    await repo.insert(c, APP, TEN, { ownerUserId: 'u1', kind: 'k', bucket: 'b', key: 'kk' })
    const params = c.query.mock.calls[0][1]
    expect(params[2]).toBeNull()        // subTenantId
    expect(params[7]).toBeNull()        // filename
    expect(params[8]).toBeNull()        // contentType
    expect(params[9]).toBeNull()        // sizeBytes
    expect(params[10]).toBeNull()       // retentionUntil
    expect(params[11]).toBe('pending')  // status default
    expect(params[12]).toEqual({})      // metadata default
  })
})

describe('findById', () => {
  it('WHERE app_id/tenant_id/id; devuelve row', async () => {
    const c = mockClient([{ id: 'o1' }])
    const r = await repo.findById(c, APP, TEN, 'o1')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE app_id=\$1 AND tenant_id=\$2 AND id=\$3/)
    expect(params).toEqual([APP, TEN, 'o1'])
    expect(r).toEqual({ id: 'o1' })
  })

  it('sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.findById(c, APP, TEN, 'o1')).toBeNull()
  })
})

describe('listByTenant', () => {
  it('sin filtros → solo app_id+tenant_id, LIMIT default 100', async () => {
    const c = mockClient([])
    await repo.listByTenant(c, APP, TEN)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE app_id = \$1 AND tenant_id = \$2/)
    expect(sql).toMatch(/ORDER BY created_at DESC/)
    expect(params).toEqual([APP, TEN, 100])
  })

  it('con todos los filtros → kind/owner/status + limit explícito', async () => {
    const c = mockClient([])
    await repo.listByTenant(c, APP, TEN, { kind: 'menu_photo', ownerUserId: 'u1', status: 'uploaded', limit: 50 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/kind = \$3/)
    expect(sql).toMatch(/owner_user_id = \$4/)
    expect(sql).toMatch(/status = \$5/)
    expect(params).toEqual([APP, TEN, 'menu_photo', 'u1', 'uploaded', 50])
  })

  it('filtro parcial (solo status) renumera placeholders', async () => {
    const c = mockClient([])
    await repo.listByTenant(c, APP, TEN, { status: 'pending' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/status = \$3/)
    expect(params).toEqual([APP, TEN, 'pending', 100])
  })
})

describe('markUploaded', () => {
  it('UPDATE status=uploaded con COALESCE de sizeBytes/sha256', async () => {
    const c = mockClient([{ id: 'o1', status: 'uploaded' }])
    const r = await repo.markUploaded(c, APP, TEN, 'o1', { sizeBytes: 500, sha256: 'abc' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET status='uploaded'/)
    expect(sql).toMatch(/size_bytes=COALESCE\(\$4, size_bytes\)/)
    expect(sql).toMatch(/sha256=COALESCE\(\$5, sha256\)/)
    expect(params).toEqual([APP, TEN, 'o1', 500, 'abc'])
    expect(r).toEqual({ id: 'o1', status: 'uploaded' })
  })

  it('nulls cuando no se pasan sizeBytes/sha256; sin row → null', async () => {
    const c = mockClient([])
    const r = await repo.markUploaded(c, APP, TEN, 'o1', {})
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'o1', null, null])
    expect(r).toBeNull()
  })
})

describe('softDelete', () => {
  it('UPDATE status=deleted, stampa deleted_at', async () => {
    const c = mockClient([{ id: 'o1', status: 'deleted' }])
    const r = await repo.softDelete(c, APP, TEN, 'o1')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET status='deleted', deleted_at=now\(\)/)
    expect(params).toEqual([APP, TEN, 'o1'])
    expect(r).toEqual({ id: 'o1', status: 'deleted' })
  })

  it('sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.softDelete(c, APP, TEN, 'o1')).toBeNull()
  })
})
