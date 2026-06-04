// resources.repository — SQL shape for platform_resources.* tables.
// Validates column projection, parametrized params, COALESCE defaults,
// optional filters, joins and tenant scoping on every query.
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/resources.repository.js'

function mockClient(rows = [], rowCount = rows.length) {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount }) }
}

const APP = 'aikikan'
const TEN = 't1'
const RID = 'r1'
const SID = 's1'

describe('insert', () => {
  it('INSERT with COALESCE defaults and full param order', async () => {
    const c = mockClient([{ id: RID }])
    const out = await repo.insert(c, APP, TEN, {
      subTenantId: 'st1', userId: 'u1', kind: 'practitioner', displayName: 'Dr. Ana',
      email: 'a@x.com', phone: '+34', bio: 'bio', capacity: 3, internalRateCents: 5000,
      isActive: false, metadata: { a: 1 }, timezone: 'Europe/Madrid',
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_resources\.resources/)
    expect(sql).toMatch(/COALESCE\(\$10,1\)/)
    expect(sql).toMatch(/COALESCE\(\$12,TRUE\)/)
    expect(sql).toMatch(/COALESCE\(\$13,'\{\}'::jsonb\)/)
    expect(params).toEqual([
      APP, TEN, 'st1', 'u1', 'practitioner', 'Dr. Ana', 'a@x.com', '+34', 'bio',
      3, 5000, false, { a: 1 }, 'Europe/Madrid',
    ])
    expect(out).toEqual({ id: RID })
  })

  it('applies nullish/default values when optionals absent', async () => {
    const c = mockClient([{ id: RID }])
    await repo.insert(c, APP, TEN, { kind: 'room', displayName: 'Room A' })
    expect(c.query.mock.calls[0][1]).toEqual([
      APP, TEN, null, null, 'room', 'Room A', null, null, null, 1, null, true, {}, null,
    ])
  })
})

describe('update', () => {
  it('builds dynamic SET clause for provided fields only, tenant-scoped', async () => {
    const c = mockClient([{ id: RID }])
    const out = await repo.update(c, APP, TEN, RID, { displayName: 'New', capacity: 5, timezone: 'UTC' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/UPDATE platform_resources\.resources SET/)
    expect(sql).toMatch(/display_name = \$4/)
    expect(sql).toMatch(/capacity = \$5/)
    expect(sql).toMatch(/timezone = \$6/)
    expect(sql).toMatch(/WHERE app_id=\$1 AND tenant_id=\$2 AND id=\$3/)
    expect(params).toEqual([APP, TEN, RID, 'New', 5, 'UTC'])
    expect(out).toEqual({ id: RID })
  })

  it('falls back to findById when patch is empty', async () => {
    const c = mockClient([{ id: RID }])
    const out = await repo.update(c, APP, TEN, RID, {})
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SELECT \* FROM platform_resources\.resources/)
    expect(params).toEqual([APP, TEN, RID])
    expect(out).toEqual({ id: RID })
  })

  it('allows nulling a column', async () => {
    const c = mockClient([{ id: RID }])
    await repo.update(c, APP, TEN, RID, { email: null })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/email = \$4/)
    expect(params).toEqual([APP, TEN, RID, null])
  })
})

describe('setActive', () => {
  it('UPDATE is_active, tenant-scoped', async () => {
    const c = mockClient([{ id: RID, is_active: false }])
    const out = await repo.setActive(c, APP, TEN, RID, false)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET is_active=\$4/)
    expect(params).toEqual([APP, TEN, RID, false])
    expect(out).toEqual({ id: RID, is_active: false })
  })
})

describe('findById', () => {
  it('tenant-scoped; missing → null', async () => {
    const c = mockClient([])
    expect(await repo.findById(c, APP, TEN, RID)).toBeNull()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE app_id=\$1 AND tenant_id=\$2 AND id=\$3/)
    expect(params).toEqual([APP, TEN, RID])
  })

  it('returns row when present', async () => {
    const c = mockClient([{ id: RID }])
    expect(await repo.findById(c, APP, TEN, RID)).toEqual({ id: RID })
  })
})

describe('listByTenant', () => {
  it('default onlyActive=true, no kind', async () => {
    const c = mockClient([])
    await repo.listByTenant(c, APP, TEN)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).not.toMatch(/kind =/)
    expect(sql).toMatch(/is_active = TRUE/)
    expect(sql).toMatch(/ORDER BY display_name/)
    expect(params).toEqual([APP, TEN])
  })

  it('kind filter appended; onlyActive=false omits is_active clause', async () => {
    const c = mockClient([])
    await repo.listByTenant(c, APP, TEN, { kind: 'room', onlyActive: false })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/kind = \$3/)
    expect(sql).not.toMatch(/is_active = TRUE/)
    expect(params).toEqual([APP, TEN, 'room'])
  })
})

describe('listForService', () => {
  it('joins resource_services and filters active', async () => {
    const c = mockClient([{ id: RID }])
    const out = await repo.listForService(c, APP, TEN, SID)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/JOIN platform_resources\.resource_services rs ON rs\.resource_id = r\.id/)
    expect(sql).toMatch(/rs\.service_id=\$3 AND r\.is_active = TRUE/)
    expect(params).toEqual([APP, TEN, SID])
    expect(out).toEqual([{ id: RID }])
  })
})

describe('attachService', () => {
  it('INSERT ... ON CONFLICT DO NOTHING', async () => {
    const c = mockClient([])
    await repo.attachService(c, APP, TEN, RID, SID)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_resources\.resource_services/)
    expect(sql).toMatch(/ON CONFLICT DO NOTHING/)
    expect(params).toEqual([APP, TEN, RID, SID])
  })
})

describe('detachService', () => {
  it('DELETE scoped by resource and service', async () => {
    const c = mockClient([])
    await repo.detachService(c, APP, TEN, RID, SID)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/DELETE FROM platform_resources\.resource_services/)
    expect(params).toEqual([APP, TEN, RID, SID])
  })
})

describe('listServicesFor', () => {
  it('returns mapped service_id array', async () => {
    const c = mockClient([{ service_id: 'a' }, { service_id: 'b' }])
    const out = await repo.listServicesFor(c, APP, TEN, RID)
    expect(out).toEqual(['a', 'b'])
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, RID])
  })
})

describe('insertWorkHours', () => {
  it('INSERT with nullish effective dates', async () => {
    const c = mockClient([{ id: 'wh1' }])
    await repo.insertWorkHours(c, APP, TEN, {
      resourceId: RID, dayOfWeek: 1, startMinute: 540, endMinute: 1080,
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_resources\.work_hours/)
    expect(params).toEqual([APP, TEN, RID, 1, 540, 1080, null, null])
  })

  it('passes explicit effective range', async () => {
    const c = mockClient([{ id: 'wh1' }])
    await repo.insertWorkHours(c, APP, TEN, {
      resourceId: RID, dayOfWeek: 2, startMinute: 0, endMinute: 60,
      effectiveFrom: '2026-01-01', effectiveUntil: '2026-12-31',
    })
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, RID, 2, 0, 60, '2026-01-01', '2026-12-31'])
  })
})

describe('listWorkHours', () => {
  it('tenant + resource scoped, ordered', async () => {
    const c = mockClient([{ id: 'wh1' }])
    const out = await repo.listWorkHours(c, APP, TEN, RID)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/ORDER BY day_of_week, start_minute/)
    expect(params).toEqual([APP, TEN, RID])
    expect(out).toEqual([{ id: 'wh1' }])
  })
})

describe('deleteWorkHours', () => {
  it('true when a row deleted', async () => {
    const c = mockClient([], 1)
    expect(await repo.deleteWorkHours(c, APP, TEN, 'wh1')).toBe(true)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'wh1'])
  })

  it('false when nothing deleted', async () => {
    const c = mockClient([], 0)
    expect(await repo.deleteWorkHours(c, APP, TEN, 'wh1')).toBe(false)
  })
})

describe('insertException', () => {
  it('INSERT with nullish reason', async () => {
    const c = mockClient([{ id: 'e1' }])
    await repo.insertException(c, APP, TEN, {
      resourceId: RID, startsAt: 'S', endsAt: 'E', kind: 'vacation',
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_resources\.exceptions/)
    expect(params).toEqual([APP, TEN, RID, 'S', 'E', 'vacation', null])
  })

  it('passes explicit reason', async () => {
    const c = mockClient([{ id: 'e1' }])
    await repo.insertException(c, APP, TEN, {
      resourceId: RID, startsAt: 'S', endsAt: 'E', kind: 'sick', reason: 'flu',
    })
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, RID, 'S', 'E', 'sick', 'flu'])
  })
})

describe('listExceptions', () => {
  it('no range → resource scope only', async () => {
    const c = mockClient([])
    await repo.listExceptions(c, APP, TEN, RID)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE app_id = \$1 AND tenant_id = \$2 AND resource_id = \$3/)
    expect(sql).toMatch(/ORDER BY starts_at/)
    expect(params).toEqual([APP, TEN, RID])
  })

  it('from + to appended in order', async () => {
    const c = mockClient([])
    await repo.listExceptions(c, APP, TEN, RID, { from: 'F', to: 'T' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/ends_at   >= \$4/)
    expect(sql).toMatch(/starts_at <  \$5/)
    expect(params).toEqual([APP, TEN, RID, 'F', 'T'])
  })
})

describe('findWorkHourById', () => {
  it('tenant-scoped lookup; null when missing', async () => {
    const c = mockClient([])
    expect(await repo.findWorkHourById(c, APP, TEN, 'wh1')).toBeNull()
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'wh1'])
  })
})

describe('updateWorkHours', () => {
  it('dynamic SET for provided fields', async () => {
    const c = mockClient([{ id: 'wh1' }])
    await repo.updateWorkHours(c, APP, TEN, 'wh1', { startMinute: 600, endMinute: 720 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/UPDATE platform_resources\.work_hours SET/)
    expect(sql).toMatch(/start_minute = \$4/)
    expect(sql).toMatch(/end_minute = \$5/)
    expect(params).toEqual([APP, TEN, 'wh1', 600, 720])
  })

  it('empty patch → findWorkHourById', async () => {
    const c = mockClient([{ id: 'wh1' }])
    await repo.updateWorkHours(c, APP, TEN, 'wh1', {})
    expect(c.query.mock.calls[0][0]).toMatch(/SELECT \* FROM platform_resources\.work_hours/)
  })
})

describe('findExceptionById', () => {
  it('tenant-scoped lookup', async () => {
    const c = mockClient([{ id: 'e1' }])
    expect(await repo.findExceptionById(c, APP, TEN, 'e1')).toEqual({ id: 'e1' })
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'e1'])
  })
})

describe('updateException', () => {
  it('dynamic SET for provided fields', async () => {
    const c = mockClient([{ id: 'e1' }])
    await repo.updateException(c, APP, TEN, 'e1', { reason: 'flu', kind: 'sick' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/UPDATE platform_resources\.exceptions SET/)
    expect(sql).toMatch(/kind = \$/)
    expect(sql).toMatch(/reason = \$/)
    expect(params).toContain('flu')
    expect(params).toContain('sick')
  })
})

describe('deleteException', () => {
  it('true when deleted', async () => {
    const c = mockClient([], 1)
    expect(await repo.deleteException(c, APP, TEN, 'e1')).toBe(true)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/DELETE FROM platform_resources\.exceptions/)
    expect(params).toEqual([APP, TEN, 'e1'])
  })

  it('false when nothing deleted', async () => {
    const c = mockClient([], 0)
    expect(await repo.deleteException(c, APP, TEN, 'e1')).toBe(false)
  })
})

describe('insertExceptionForTenant', () => {
  it('INSERT...SELECT across active resources, no filters', async () => {
    const c = mockClient([{ id: 'e1', resource_id: RID }])
    const out = await repo.insertExceptionForTenant(
      c, APP, TEN, { startsAt: 'S', endsAt: 'E', kind: 'holiday', reason: 'Xmas' },
    )
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_resources\.exceptions/)
    expect(sql).toMatch(/SELECT app_id, tenant_id, id, \$3, \$4, \$5, \$6/)
    expect(sql).toMatch(/is_active = TRUE/)
    expect(params).toEqual([APP, TEN, 'S', 'E', 'holiday', 'Xmas'])
    expect(out).toEqual([{ id: 'e1', resource_id: RID }])
  })

  it('appends kind + sub_tenant filters', async () => {
    const c = mockClient([])
    await repo.insertExceptionForTenant(
      c, APP, TEN, { startsAt: 'S', endsAt: 'E', kind: 'holiday' },
      { kind: 'practitioner', subTenantId: 'st1' },
    )
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/kind = \$7/)
    expect(sql).toMatch(/sub_tenant_id = \$8/)
    expect(params).toEqual([APP, TEN, 'S', 'E', 'holiday', null, 'practitioner', 'st1'])
  })
})
