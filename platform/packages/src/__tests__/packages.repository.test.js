// packages.repository — SQL shape de platform_packages.
// Valida tabla, scoping (app_id/tenant_id), proyección de columnas,
// params parametrizados y branches opcionales (onlyActive, COALESCE defaults).
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/packages.repository.js'

function mockClient(rows = [], rowCount = rows.length) {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount }) }
}

const APP = 'yoga'
const TEN = 't1'
const PKG = 'pkg1'
const USER = 'u1'
const SVC = 'svc1'

describe('insertTemplate', () => {
  it('INSERT en package_templates con defaults via COALESCE', async () => {
    const c = mockClient([{ id: 'tpl1' }])
    const r = await repo.insertTemplate(c, APP, TEN, {
      code: 'P10', name: '10x', serviceId: SVC, totalSessions: 10,
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_packages\.package_templates/)
    expect(sql).toMatch(/RETURNING \*/)
    expect(params[0]).toBe(APP)
    expect(params[1]).toBe(TEN)
    expect(params[2]).toBe('P10')
    expect(params[4]).toBeNull()        // description default null
    expect(params[7]).toBe(365)         // validityDays default
    expect(params[8]).toBe(0)           // priceCents default
    expect(params[9]).toBe('EUR')       // currency default
    expect(params[10]).toBe(true)       // isActive default
    expect(params[11]).toEqual({})      // metadata default
    expect(r).toEqual({ id: 'tpl1' })
  })

  it('respeta valores explícitos cuando se proporcionan', async () => {
    const c = mockClient([{ id: 'tpl1' }])
    await repo.insertTemplate(c, APP, TEN, {
      code: 'P', name: 'n', description: 'd', serviceId: SVC, totalSessions: 5,
      validityDays: 30, priceCents: 9000, currency: 'USD', isActive: false, metadata: { k: 1 },
    })
    const params = c.query.mock.calls[0][1]
    expect(params[4]).toBe('d')
    expect(params[7]).toBe(30)
    expect(params[8]).toBe(9000)
    expect(params[9]).toBe('USD')
    expect(params[10]).toBe(false)
    expect(params[11]).toEqual({ k: 1 })
  })
})

describe('findTemplateById', () => {
  it('SELECT scoped por app/tenant/id; sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.findTemplateById(c, APP, TEN, 'tpl9')).toBeNull()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/FROM platform_packages\.package_templates/)
    expect(sql).toMatch(/app_id=\$1 AND tenant_id=\$2 AND id=\$3/)
    expect(params).toEqual([APP, TEN, 'tpl9'])
  })

  it('devuelve el row cuando existe', async () => {
    const c = mockClient([{ id: 'tpl1' }])
    expect(await repo.findTemplateById(c, APP, TEN, 'tpl1')).toEqual({ id: 'tpl1' })
  })
})

describe('listTemplates', () => {
  it('onlyActive (default) → filtro is_active=TRUE; ORDER BY name', async () => {
    const c = mockClient([])
    await repo.listTemplates(c, APP, TEN)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/is_active = TRUE/)
    expect(sql).toMatch(/ORDER BY name/)
    expect(params).toEqual([APP, TEN])
  })

  it('onlyActive=false → sin filtro is_active', async () => {
    const c = mockClient([])
    await repo.listTemplates(c, APP, TEN, { onlyActive: false })
    expect(c.query.mock.calls[0][0]).not.toMatch(/is_active/)
  })
})

describe('insertPurchase', () => {
  it('INSERT en purchased_packages con defaults', async () => {
    const c = mockClient([{ id: PKG }])
    await repo.insertPurchase(c, APP, TEN, {
      templateId: 'tpl1', clientUserId: USER, serviceId: SVC,
      totalSessions: 10, remainingSessions: 10, expiresAt: '2026-01-01',
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_packages\.purchased_packages/)
    expect(params[7]).toBe(0)       // pricePaidCents default
    expect(params[8]).toBe('EUR')   // currency default
    expect(params[9]).toBe('active') // status default
    expect(params[11]).toEqual({})  // metadata default
  })
})

describe('findPurchaseById', () => {
  it('SELECT scoped; sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.findPurchaseById(c, APP, TEN, PKG)).toBeNull()
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, PKG])
  })
})

describe('listPurchasesForClient', () => {
  it('onlyActive default → filtro status/expires/remaining; ORDER BY purchased_at DESC', async () => {
    const c = mockClient([])
    await repo.listPurchasesForClient(c, APP, TEN, USER)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/status = 'active' AND expires_at > now\(\) AND remaining_sessions > 0/)
    expect(sql).toMatch(/ORDER BY purchased_at DESC/)
    expect(params).toEqual([APP, TEN, USER])
  })

  it('onlyActive=false → sin filtro de estado', async () => {
    const c = mockClient([])
    await repo.listPurchasesForClient(c, APP, TEN, USER, { onlyActive: false })
    expect(c.query.mock.calls[0][0]).not.toMatch(/status = 'active'/)
  })
})

describe('findActivePackageFor', () => {
  it('SELECT con LIMIT 1 ordenado por expires_at ASC; sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.findActivePackageFor(c, APP, TEN, USER, SVC)).toBeNull()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/ORDER BY expires_at ASC/)
    expect(sql).toMatch(/LIMIT 1/)
    expect(params).toEqual([APP, TEN, USER, SVC])
  })
})

describe('decrementSessions', () => {
  it('UPDATE con delta y guard remaining+delta>=0; flip a exhausted', async () => {
    const c = mockClient([{ id: PKG, status: 'exhausted' }])
    const r = await repo.decrementSessions(c, APP, TEN, PKG, -1)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/UPDATE platform_packages\.purchased_packages/)
    expect(sql).toMatch(/remaining_sessions \+ \$4 >= 0/)
    expect(sql).toMatch(/'exhausted'/)
    expect(params).toEqual([APP, TEN, PKG, -1])
    expect(r).toEqual({ id: PKG, status: 'exhausted' })
  })

  it('sin row (guard falla) → null', async () => {
    const c = mockClient([])
    expect(await repo.decrementSessions(c, APP, TEN, PKG, -1)).toBeNull()
  })
})

describe('setStatus', () => {
  it('UPDATE status scoped; sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.setStatus(c, APP, TEN, PKG, 'active')).toBeNull()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET status=\$4/)
    expect(params).toEqual([APP, TEN, PKG, 'active'])
  })
})

describe('insertRedemption', () => {
  it('INSERT en redemptions con bookingId default null', async () => {
    const c = mockClient([])
    await repo.insertRedemption(c, APP, TEN, { packageId: PKG, delta: -1, reason: 'redeem' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_packages\.redemptions/)
    expect(params).toEqual([APP, TEN, PKG, null, -1, 'redeem'])
  })

  it('respeta bookingId explícito', async () => {
    const c = mockClient([])
    await repo.insertRedemption(c, APP, TEN, { packageId: PKG, bookingId: 'b1', delta: 1, reason: 'refund' })
    expect(c.query.mock.calls[0][1][3]).toBe('b1')
  })
})

describe('listRedemptions', () => {
  it('SELECT scoped por package; ORDER BY created_at', async () => {
    const c = mockClient([{ delta: -1 }])
    const r = await repo.listRedemptions(c, APP, TEN, PKG)
    expect(c.query.mock.calls[0][0]).toMatch(/ORDER BY created_at/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, PKG])
    expect(r).toEqual([{ delta: -1 }])
  })
})

describe('listAuthorizedUsers', () => {
  it('SELECT package_authorized_users scoped', async () => {
    const c = mockClient([{ user_id: USER }])
    await repo.listAuthorizedUsers(c, APP, TEN, PKG)
    expect(c.query.mock.calls[0][0]).toMatch(/FROM platform_packages\.package_authorized_users/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, PKG])
  })
})

describe('addAuthorizedUser', () => {
  it('INSERT con ON CONFLICT upsert display_name; defaults null', async () => {
    const c = mockClient([{ user_id: USER }])
    await repo.addAuthorizedUser(c, APP, TEN, PKG, { userId: USER })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/ON CONFLICT \(package_id, user_id\) DO UPDATE/)
    expect(params).toEqual([APP, TEN, PKG, USER, null, null])
  })

  it('respeta displayName y addedBy', async () => {
    const c = mockClient([{}])
    await repo.addAuthorizedUser(c, APP, TEN, PKG, { userId: USER, displayName: 'Ana', addedBy: 'owner' })
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, PKG, USER, 'Ana', 'owner'])
  })
})

describe('removeAuthorizedUser', () => {
  it('DELETE → true cuando rowCount>0', async () => {
    const c = mockClient([], 1)
    expect(await repo.removeAuthorizedUser(c, APP, TEN, PKG, USER)).toBe(true)
    expect(c.query.mock.calls[0][0]).toMatch(/DELETE FROM platform_packages\.package_authorized_users/)
  })

  it('DELETE → false cuando rowCount=0', async () => {
    const c = mockClient([], 0)
    expect(await repo.removeAuthorizedUser(c, APP, TEN, PKG, USER)).toBe(false)
  })
})

describe('isAuthorized', () => {
  it('true cuando hay row', async () => {
    const c = mockClient([{ '?column?': 1 }])
    expect(await repo.isAuthorized(c, APP, TEN, PKG, USER)).toBe(true)
    expect(c.query.mock.calls[0][0]).toMatch(/LIMIT 1/)
  })

  it('false cuando no hay row', async () => {
    const c = mockClient([])
    expect(await repo.isAuthorized(c, APP, TEN, PKG, USER)).toBe(false)
  })
})

describe('transferOwnership', () => {
  it('null cuando el UPDATE de ownership no afecta filas (no encadena INSERT)', async () => {
    const c = { query: vi.fn().mockResolvedValueOnce({ rows: [] }) }
    expect(await repo.transferOwnership(c, APP, TEN, PKG, 'from', 'to', 'gift', 'msg', 'actor')).toBeNull()
    expect(c.query).toHaveBeenCalledTimes(1)
  })

  it('encadena INSERT en package_transfers y devuelve {package, transfer}', async () => {
    const c = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: PKG, client_user_id: 'to' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'tr1' }] }),
    }
    const r = await repo.transferOwnership(c, APP, TEN, PKG, 'from', 'to', 'transfer', null, null)
    expect(c.query.mock.calls[0][0]).toMatch(/UPDATE platform_packages\.purchased_packages/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, PKG, 'to', 'from'])
    expect(c.query.mock.calls[1][0]).toMatch(/INSERT INTO platform_packages\.package_transfers/)
    expect(c.query.mock.calls[1][1]).toEqual([APP, TEN, PKG, 'from', 'to', 'transfer', null, null])
    expect(r).toEqual({ package: { id: PKG, client_user_id: 'to' }, transfer: { id: 'tr1' } })
  })
})

describe('listTransfers', () => {
  it('SELECT package_transfers ORDER BY created_at DESC', async () => {
    const c = mockClient([{ id: 'tr1' }])
    await repo.listTransfers(c, APP, TEN, PKG)
    expect(c.query.mock.calls[0][0]).toMatch(/FROM platform_packages\.package_transfers/)
    expect(c.query.mock.calls[0][0]).toMatch(/ORDER BY created_at DESC/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, PKG])
  })
})

describe('setAutoRenew', () => {
  it('UPDATE auto_renew con coerción a boolean; sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.setAutoRenew(c, APP, TEN, PKG, 1)).toBeNull()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET auto_renew = \$4/)
    expect(params).toEqual([APP, TEN, PKG, true])
  })
})

describe('insertRenewal', () => {
  it('INSERT clona template y enlaza renewed_from', async () => {
    const c = mockClient([{ id: 'new1' }])
    const original = { id: 'old1', client_user_id: USER, auto_renew: true }
    const template = {
      id: 'tpl1', service_id: SVC, total_sessions: 8,
      price_cents: 5000, currency: 'EUR', validity_days: 90,
    }
    const r = await repo.insertRenewal(c, APP, TEN, original, template)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_packages\.purchased_packages/)
    expect(sql).toMatch(/renewed_from/)
    expect(params).toEqual([
      APP, TEN, 'tpl1', USER, SVC, 8, 5000, 'EUR', '90', true, 'old1',
    ])
    expect(r).toEqual({ id: 'new1' })
  })
})
