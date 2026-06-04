// floor-plan.repository — SQL shape de platform_floor_plan.*.
// Valida scoping (app_id + tenant_id), defaults COALESCE, filtros opcionales
// y proyección de columnas.
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/floor-plan.repository.js'

function mockClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

const APP = 'aikikan'
const TEN = 't1'

describe('insertSection', () => {
  it('INSERT con defaults COALESCE para is_outdoor/display_order', async () => {
    const c = mockClient([{ id: 's1' }])
    const r = await repo.insertSection(c, { appId: APP, tenantId: TEN, name: 'Terraza', description: 'd', isOutdoor: true, displayOrder: 3 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_floor_plan\.sections/)
    expect(sql).toMatch(/COALESCE\(\$5,FALSE\),COALESCE\(\$6,0\)/)
    expect(params).toEqual([APP, TEN, 'Terraza', 'd', true, 3])
    expect(r).toEqual({ id: 's1' })
  })

  it('opcionales ausentes → null/false/0', async () => {
    const c = mockClient([{ id: 's1' }])
    await repo.insertSection(c, { appId: APP, tenantId: TEN, name: 'X' })
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'X', null, false, 0])
  })
})

describe('listSections', () => {
  it('scopea y ordena por display_order, name', async () => {
    const c = mockClient([{ id: 's1' }])
    const r = await repo.listSections(c, APP, TEN)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE app_id=\$1 AND tenant_id=\$2/)
    expect(sql).toMatch(/ORDER BY display_order, name/)
    expect(params).toEqual([APP, TEN])
    expect(r).toEqual([{ id: 's1' }])
  })
})

describe('insertTable', () => {
  it('INSERT con shape default square y posiciones', async () => {
    const c = mockClient([{ id: 't1' }])
    await repo.insertTable(c, { appId: APP, tenantId: TEN, sectionId: 's1', code: 'A1', capacity: 4, shape: 'round', posX: 10, posY: 20 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_floor_plan\.tables/)
    expect(sql).toMatch(/COALESCE\(\$6,'square'\)/)
    expect(params).toEqual([APP, TEN, 's1', 'A1', 4, 'round', 10, 20])
  })

  it('shape/posiciones ausentes → square/null', async () => {
    const c = mockClient([{ id: 't1' }])
    await repo.insertTable(c, { appId: APP, tenantId: TEN, sectionId: 's1', code: 'A1', capacity: 4 })
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 's1', 'A1', 4, 'square', null, null])
  })
})

describe('listTables', () => {
  it('sin filtros → solo app_id+tenant_id', async () => {
    const c = mockClient([])
    await repo.listTables(c, APP, TEN)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).not.toMatch(/section_id/)
    expect(sql).not.toMatch(/status = /)
    expect(sql).toMatch(/ORDER BY code/)
    expect(params).toEqual([APP, TEN])
  })

  it('con sectionId y status → ambos filtros parametrizados', async () => {
    const c = mockClient([])
    await repo.listTables(c, APP, TEN, { sectionId: 's1', status: 'free' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/section_id = \$3/)
    expect(sql).toMatch(/status = \$4/)
    expect(params).toEqual([APP, TEN, 's1', 'free'])
  })

  it('solo status → status en $3', async () => {
    const c = mockClient([])
    await repo.listTables(c, APP, TEN, { status: 'occupied' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/status = \$3/)
    expect(params).toEqual([APP, TEN, 'occupied'])
  })
})

describe('findTableById', () => {
  it('scopea por id; sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.findTableById(c, APP, TEN, 't9')).toBeNull()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE app_id=\$1 AND tenant_id=\$2 AND id=\$3/)
    expect(params).toEqual([APP, TEN, 't9'])
  })

  it('devuelve la fila cuando existe', async () => {
    const c = mockClient([{ id: 't1' }])
    expect(await repo.findTableById(c, APP, TEN, 't1')).toEqual({ id: 't1' })
  })
})

describe('setTableStatus', () => {
  it('UPDATE status + updated_at scopeado; sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.setTableStatus(c, APP, TEN, 't1', 'occupied')).toBeNull()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET status=\$4, updated_at=now\(\)/)
    expect(params).toEqual([APP, TEN, 't1', 'occupied'])
  })

  it('devuelve la fila actualizada', async () => {
    const c = mockClient([{ id: 't1', status: 'occupied' }])
    expect(await repo.setTableStatus(c, APP, TEN, 't1', 'occupied')).toEqual({ id: 't1', status: 'occupied' })
  })
})

describe('combineTables', () => {
  it('UPDATE combined_with con array de ids; sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.combineTables(c, APP, TEN, 't1', ['t2', 't3'])).toBeNull()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET combined_with=\$4/)
    expect(params).toEqual([APP, TEN, 't1', ['t2', 't3']])
  })
})

describe('updateSection', () => {
  it('build dynamic SET con campos presentes', async () => {
    const c = mockClient([{ id: 's1' }])
    await repo.updateSection(c, APP, TEN, 's1', { name: 'Nueva', isOutdoor: true })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/UPDATE platform_floor_plan\.sections SET name=\$4, is_outdoor=\$5/)
    expect(params).toEqual([APP, TEN, 's1', 'Nueva', true])
  })

  it('sin campos → SELECT pasivo', async () => {
    const c = mockClient([{ id: 's1' }])
    await repo.updateSection(c, APP, TEN, 's1', {})
    expect(c.query.mock.calls[0][0]).toMatch(/SELECT \* FROM platform_floor_plan\.sections/)
  })
})

describe('countTablesInSection / deleteSection', () => {
  it('count devuelve entero', async () => {
    const c = mockClient([{ n: 2 }])
    expect(await repo.countTablesInSection(c, APP, TEN, 's1')).toBe(2)
  })
  it('delete scopeado; sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.deleteSection(c, APP, TEN, 's1')).toBeNull()
    expect(c.query.mock.calls[0][0]).toMatch(/DELETE FROM platform_floor_plan\.sections WHERE app_id=\$1 AND tenant_id=\$2 AND id=\$3/)
  })
})

describe('updateTable', () => {
  it('SET dinámico + updated_at', async () => {
    const c = mockClient([{ id: 't1' }])
    await repo.updateTable(c, APP, TEN, 't1', { capacity: 6, shape: 'oval' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET capacity=\$4, shape=\$5, updated_at=now\(\)/)
    expect(params).toEqual([APP, TEN, 't1', 6, 'oval'])
  })
  it('sin campos → findTableById', async () => {
    const c = mockClient([{ id: 't1' }])
    await repo.updateTable(c, APP, TEN, 't1', {})
    expect(c.query.mock.calls[0][0]).toMatch(/SELECT \* FROM platform_floor_plan\.tables WHERE app_id=\$1/)
  })
})

describe('deleteTable', () => {
  it('DELETE scopeado', async () => {
    const c = mockClient([{ id: 't1' }])
    await repo.deleteTable(c, APP, TEN, 't1')
    expect(c.query.mock.calls[0][0]).toMatch(/DELETE FROM platform_floor_plan\.tables/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 't1'])
  })
})

describe('findTablesByIds / findTableByCode / clearCombined', () => {
  it('findTablesByIds vacío → [] sin query', async () => {
    const c = mockClient([])
    expect(await repo.findTablesByIds(c, APP, TEN, [])).toEqual([])
    expect(c.query).not.toHaveBeenCalled()
  })
  it('findTablesByIds usa ANY($3::uuid[])', async () => {
    const c = mockClient([{ id: 't2' }])
    await repo.findTablesByIds(c, APP, TEN, ['t2', 't3'])
    expect(c.query.mock.calls[0][0]).toMatch(/id = ANY\(\$3::uuid\[\]\)/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, ['t2', 't3']])
  })
  it('findTableByCode scopeado por code', async () => {
    const c = mockClient([{ id: 't1' }])
    await repo.findTableByCode(c, APP, TEN, 'A1')
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'A1'])
  })
  it('clearCombined resetea a {}', async () => {
    const c = mockClient([{ id: 't1', combined_with: [] }])
    await repo.clearCombined(c, APP, TEN, 't1')
    expect(c.query.mock.calls[0][0]).toMatch(/SET combined_with='\{\}'/)
  })
})

describe('listTableEvents', () => {
  it('sin filtros → solo scope + limit/offset', async () => {
    const c = mockClient([])
    await repo.listTableEvents(c, APP, TEN, 't1')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/table_id = \$3/)
    expect(sql).toMatch(/ORDER BY ts DESC LIMIT \$4 OFFSET \$5/)
    expect(params).toEqual([APP, TEN, 't1', 100, 0])
  })
  it('con from/to/toStatus parametrizados', async () => {
    const c = mockClient([])
    await repo.listTableEvents(c, APP, TEN, 't1', { from: 'F', to: 'T', toStatus: 'occupied', limit: 10, offset: 5 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/ts >= \$4/)
    expect(sql).toMatch(/ts <= \$5/)
    expect(sql).toMatch(/to_status = \$6/)
    expect(params).toEqual([APP, TEN, 't1', 'F', 'T', 'occupied', 10, 5])
  })
})

describe('occupancySnapshot', () => {
  it('agrega capacidad/ocupación scopeado; sin sectionId', async () => {
    const c = mockClient([{ total_capacity: 40, occupied_tables: 3, seated_guests: 9 }])
    const r = await repo.occupancySnapshot(c, APP, TEN)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/FROM platform_floor_plan\.tables t/)
    expect(sql).toMatch(/seated_guests/)
    expect(params).toEqual([APP, TEN])
    expect(r.seated_guests).toBe(9)
  })
  it('con sectionId añade filtro', async () => {
    const c = mockClient([{}])
    await repo.occupancySnapshot(c, APP, TEN, { sectionId: 's1' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/t\.section_id = \$3/)
    expect(params).toEqual([APP, TEN, 's1'])
  })
})

describe('recordTableEvent', () => {
  it('INSERT en table_events con defaults null', async () => {
    const c = mockClient([])
    await repo.recordTableEvent(c, { appId: APP, tenantId: TEN, tableId: 't1', toStatus: 'occupied' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_floor_plan\.table_events/)
    expect(params).toEqual([APP, TEN, 't1', null, 'occupied', null, null, null])
  })

  it('pasa todos los campos cuando vienen', async () => {
    const c = mockClient([])
    await repo.recordTableEvent(c, {
      appId: APP, tenantId: TEN, tableId: 't1', fromStatus: 'free', toStatus: 'reserved',
      reservationId: 'r1', partySize: 4, actorUserId: 'u1',
    })
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 't1', 'free', 'reserved', 'r1', 4, 'u1'])
  })
})
