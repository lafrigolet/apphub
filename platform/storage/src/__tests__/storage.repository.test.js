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
  // listByTenant fetches limit+1 to detect a next page, and returns
  // { items, nextCursor }.
  it('sin filtros → solo app_id+tenant_id, LIMIT default 100 (+1 probe)', async () => {
    const c = mockClient([])
    const r = await repo.listByTenant(c, APP, TEN)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE app_id = \$1 AND tenant_id = \$2/)
    expect(sql).toMatch(/ORDER BY created_at DESC, id DESC/)
    expect(params).toEqual([APP, TEN, 101])
    expect(r).toEqual({ items: [], nextCursor: null })
  })

  it('con todos los filtros → kind/owner/status + limit explícito', async () => {
    const c = mockClient([])
    await repo.listByTenant(c, APP, TEN, { kind: 'menu_photo', ownerUserId: 'u1', status: 'uploaded', limit: 50 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/kind = \$3/)
    expect(sql).toMatch(/owner_user_id = \$4/)
    expect(sql).toMatch(/status = \$5/)
    expect(params).toEqual([APP, TEN, 'menu_photo', 'u1', 'uploaded', 51])
  })

  it('filtro parcial (solo status) renumera placeholders', async () => {
    const c = mockClient([])
    await repo.listByTenant(c, APP, TEN, { status: 'pending' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/status = \$3/)
    expect(params).toEqual([APP, TEN, 'pending', 101])
  })

  it('cursor → cláusula (created_at, id) < (…) y nextCursor cuando hay página siguiente', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: `o${i}`, created_at: new Date(`2030-01-0${i + 1}T00:00:00Z`),
    }))
    const c = mockClient(rows)               // limit=2 → 3 rows returned, pop the extra
    const r = await repo.listByTenant(c, APP, TEN, { limit: 2, cursor: '2030-02-01T00:00:00.000Z|zzz' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/\(created_at, id\) < \(\$3::timestamptz, \$4::uuid\)/)
    expect(params).toEqual([APP, TEN, '2030-02-01T00:00:00.000Z', 'zzz', 3])
    expect(r.items).toHaveLength(2)
    expect(r.nextCursor).toBe('2030-01-02T00:00:00.000Z|o1')
  })
})

describe('usage / quota / restore / purge', () => {
  it('usageByTenant suma size_bytes de uploaded', async () => {
    const c = mockClient([{ bytes_used: '1500', object_count: 3 }])
    const r = await repo.usageByTenant(c, APP, TEN)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SUM\(size_bytes\)/)
    expect(sql).toMatch(/status = 'uploaded'/)
    expect(params).toEqual([APP, TEN])
    expect(r).toEqual({ bytesUsed: 1500, objectCount: 3 })
  })

  it('getQuota → null cuando no hay fila', async () => {
    const c = mockClient([])
    expect(await repo.getQuota(c, APP, TEN)).toBeNull()
  })

  it('getQuota → número cuando hay fila', async () => {
    const c = mockClient([{ max_bytes: '999' }])
    expect(await repo.getQuota(c, APP, TEN)).toBe(999)
  })

  it('upsertQuota hace ON CONFLICT y devuelve max_bytes', async () => {
    const c = mockClient([{ max_bytes: '4096' }])
    const r = await repo.upsertQuota(c, APP, TEN, 4096)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/ON CONFLICT \(app_id, tenant_id\)/)
    expect(params).toEqual([APP, TEN, 4096])
    expect(r).toBe(4096)
  })

  it('restore solo afecta filas deleted', async () => {
    const c = mockClient([{ id: 'o1', status: 'uploaded' }])
    const r = await repo.restore(c, APP, TEN, 'o1')
    const [sql] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET status = 'uploaded', deleted_at = NULL/)
    expect(sql).toMatch(/AND status = 'deleted'/)
    expect(r).toEqual({ id: 'o1', status: 'uploaded' })
  })

  it('purgeRow DELETE físico → true cuando borra', async () => {
    const c = { query: vi.fn().mockResolvedValue({ rowCount: 1 }) }
    expect(await repo.purgeRow(c, APP, TEN, 'o1')).toBe(true)
    expect(c.query.mock.calls[0][0]).toMatch(/DELETE FROM platform_storage\.objects/)
  })

  it('purgeRow → false cuando no había fila', async () => {
    const c = { query: vi.fn().mockResolvedValue({ rowCount: 0 }) }
    expect(await repo.purgeRow(c, APP, TEN, 'o1')).toBe(false)
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

describe('access log', () => {
  it('insertAccessLog escopa app_id/tenant_id y aplica defaults', async () => {
    const c = mockClient([{ id: 'a1' }])
    const r = await repo.insertAccessLog(c, APP, TEN, { objectId: 'o1', kind: 'signature' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_storage\.access_log/)
    expect(params[0]).toBe(APP)
    expect(params[1]).toBe(TEN)
    expect(params[2]).toBe('o1')
    expect(params[3]).toBe('signature')
    expect(params[4]).toBe('download')   // action default
    expect(params[5]).toBeNull()         // userId
    expect(r).toEqual({ id: 'a1' })
  })

  it('listAccessLog filtra por object_id y devuelve nextCursor', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: `a${i}`, created_at: new Date(`2030-01-0${i + 1}T00:00:00Z`),
    }))
    const c = mockClient(rows)
    const r = await repo.listAccessLog(c, APP, TEN, { objectId: 'o1', limit: 2 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/FROM platform_storage\.access_log/)
    expect(sql).toMatch(/object_id = \$3/)
    expect(params).toEqual([APP, TEN, 'o1', 3])
    expect(r.items).toHaveLength(2)
    expect(r.nextCursor).toBe('2030-01-02T00:00:00.000Z|a1')
  })

  it('listAccessLog sin filtros → solo app_id+tenant_id', async () => {
    const c = mockClient([])
    await repo.listAccessLog(c, APP, TEN)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE app_id = \$1 AND tenant_id = \$2/)
    expect(params).toEqual([APP, TEN, 101])
  })
})

describe('retention helpers', () => {
  it('findExpired escopa tenant y filtra retention_until <= now()', async () => {
    const c = mockClient([{ id: 'o1' }])
    const r = await repo.findExpired(c, APP, TEN, { limit: 50 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/retention_until IS NOT NULL AND retention_until <= now\(\)/)
    expect(sql).toMatch(/app_id = \$1 AND tenant_id = \$2/)
    expect(params).toEqual([APP, TEN, 50])
    expect(r).toEqual([{ id: 'o1' }])
  })

  it('findExpiringSoon usa ventana en días e ignora ya-expirados', async () => {
    const c = mockClient([{ id: 'o1' }])
    await repo.findExpiringSoon(c, APP, TEN, { windowDays: 7, limit: 100 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/status = 'uploaded'/)
    expect(sql).toMatch(/retention_until > now\(\)/)
    expect(sql).toMatch(/retention_until <= now\(\) \+ \(\$3 \|\| ' days'\)::interval/)
    expect(params).toEqual([APP, TEN, '7', 100])
  })
})
