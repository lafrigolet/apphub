// kds.repository — SQL shape de platform_kds.{stations,tickets,ticket_items}.
// Valida proyección, scoping (app_id + tenant_id), params parametrizados,
// los filtros opcionales de listTickets, el routing por course y el stamping de status.
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/kds.repository.js'

const APP = 'resto'
const TEN = 't1'

function mockClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

describe('insertStation', () => {
  it('INSERT con defaults COALESCE para order/courses/active', async () => {
    const c = mockClient([{ id: 'st1' }])
    await repo.insertStation(c, { appId: APP, tenantId: TEN, name: 'Caliente' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_kds\.stations/)
    expect(sql).toMatch(/COALESCE\(\$4,0\)/)
    expect(sql).toMatch(/COALESCE\(\$5,'\{\}'::text\[\]\)/)
    expect(sql).toMatch(/COALESCE\(\$6,TRUE\)/)
    expect(params).toEqual([APP, TEN, 'Caliente', 0, [], true])
  })

  it('respeta valores explícitos', async () => {
    const c = mockClient([{ id: 'st1' }])
    await repo.insertStation(c, {
      appId: APP, tenantId: TEN, name: 'Fría', displayOrder: 2,
      routesCourses: ['starter'], isActive: false,
    })
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'Fría', 2, ['starter'], false])
  })
})

describe('listStations', () => {
  it('scope app/tenant; ORDER BY display_order, name', async () => {
    const c = mockClient([{ id: 'st1' }])
    const r = await repo.listStations(c, APP, TEN)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE app_id=\$1 AND tenant_id=\$2 ORDER BY display_order, name/)
    expect(params).toEqual([APP, TEN])
    expect(r).toEqual([{ id: 'st1' }])
  })
})

describe('findStationByCourse', () => {
  it('filtra estaciones activas que rutean el course (ANY); sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.findStationByCourse(c, APP, TEN, 'main')).toBeNull()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/is_active = TRUE/)
    expect(sql).toMatch(/\$3 = ANY\(routes_courses\)/)
    expect(sql).toMatch(/ORDER BY display_order LIMIT 1/)
    expect(params).toEqual([APP, TEN, 'main'])
  })

  it('devuelve la estación cuando matchea', async () => {
    const c = mockClient([{ id: 'st1' }])
    expect(await repo.findStationByCourse(c, APP, TEN, 'main')).toEqual({ id: 'st1' })
  })
})

describe('insertTicket', () => {
  it('INSERT con defaults COALESCE course=main, status=fired', async () => {
    const c = mockClient([{ id: 'tk1' }])
    await repo.insertTicket(c, { appId: APP, tenantId: TEN, orderId: 'ord1' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_kds\.tickets/)
    expect(sql).toMatch(/COALESCE\(\$5,'main'\)/)
    expect(sql).toMatch(/COALESCE\(\$6,'fired'\)/)
    expect(params).toEqual([APP, TEN, 'ord1', null, 'main', 'fired', null, null])
  })

  it('respeta station/course/status/tableCode/notes explícitos', async () => {
    const c = mockClient([{ id: 'tk1' }])
    await repo.insertTicket(c, {
      appId: APP, tenantId: TEN, orderId: 'ord1', stationId: 'st1',
      course: 'starter', status: 'in_progress', tableCode: '5', notes: 'sin sal',
    })
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'ord1', 'st1', 'starter', 'in_progress', '5', 'sin sal'])
  })
})

describe('insertTicketItem', () => {
  it('INSERT con modifiers serializados a jsonb (default [])', async () => {
    const c = mockClient([])
    await repo.insertTicketItem(c, { appId: APP, tenantId: TEN, ticketId: 'tk1', sku: 'X', name: 'X', qty: 2 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_kds\.ticket_items/)
    expect(sql).toMatch(/COALESCE\(\$7,'\[\]'::jsonb\)/)
    expect(params).toEqual([APP, TEN, 'tk1', 'X', 'X', 2, JSON.stringify([]), null])
  })

  it('serializa modifiers + notes explícitos', async () => {
    const c = mockClient([])
    await repo.insertTicketItem(c, {
      appId: APP, tenantId: TEN, ticketId: 'tk1', sku: 'X', name: 'X', qty: 1,
      modifiers: [{ k: 'extra' }], notes: 'poco hecho',
    })
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'tk1', 'X', 'X', 1, JSON.stringify([{ k: 'extra' }]), 'poco hecho'])
  })
})

describe('listTickets', () => {
  it('sin filtros → solo scope + LIMIT default 100', async () => {
    const c = mockClient([{ id: 'tk1' }])
    await repo.listTickets(c, APP, TEN)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE app_id = \$1 AND tenant_id = \$2/)
    expect(sql).toMatch(/ORDER BY fired_at ASC LIMIT \$3/)
    expect(sql).not.toMatch(/station_id =/)
    expect(sql).not.toMatch(/status =/)
    expect(params).toEqual([APP, TEN, 100])
  })

  it('con stationId + status → añade filtros numerados y limit al final', async () => {
    const c = mockClient([])
    await repo.listTickets(c, APP, TEN, { stationId: 'st1', status: 'fired', limit: 20 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/station_id = \$3/)
    expect(sql).toMatch(/status = \$4/)
    expect(sql).toMatch(/LIMIT \$5/)
    expect(params).toEqual([APP, TEN, 'st1', 'fired', 20])
  })

  it('solo status → station_id ocupa $3', async () => {
    const c = mockClient([])
    await repo.listTickets(c, APP, TEN, { status: 'ready' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/status = \$3/)
    expect(params).toEqual([APP, TEN, 'ready', 100])
  })
})

describe('findTicketById', () => {
  it('WHERE app_id+tenant_id+id; sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.findTicketById(c, APP, TEN, 'x')).toBeNull()
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'x'])
  })

  it('devuelve la fila', async () => {
    const c = mockClient([{ id: 'tk1' }])
    expect(await repo.findTicketById(c, APP, TEN, 'tk1')).toEqual({ id: 'tk1' })
  })
})

describe('findItemsByTicket', () => {
  it('filtra por ticket_id', async () => {
    const c = mockClient([{ id: 'i1' }])
    const r = await repo.findItemsByTicket(c, APP, TEN, 'tk1')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE app_id=\$1 AND tenant_id=\$2 AND ticket_id=\$3/)
    expect(params).toEqual([APP, TEN, 'tk1'])
    expect(r).toEqual([{ id: 'i1' }])
  })
})

describe('setTicketStatus', () => {
  it('UPDATE status + columna de timestamp interpolada (tsCol)', async () => {
    const c = mockClient([{ id: 'tk1', status: 'ready' }])
    const r = await repo.setTicketStatus(c, APP, TEN, 'tk1', 'ready', 'ready_at')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET status=\$4, ready_at=now\(\)/)
    expect(params).toEqual([APP, TEN, 'tk1', 'ready'])
    expect(r).toEqual({ id: 'tk1', status: 'ready' })
  })

  it('row inexistente → null', async () => {
    const c = mockClient([])
    expect(await repo.setTicketStatus(c, APP, TEN, 'x', 'ready', 'ready_at')).toBeNull()
  })
})
