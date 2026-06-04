// services.repository — SQL shape de platform_services.services + categories +
// service_images + service_pricing_tiers. Valida proyección, params
// parametrizados (anti-injection), filtros opcionales y COALESCE defaults.
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/services.repository.js'

function mockClient(rows = [], rowCount) {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount: rowCount ?? rows.length }) }
}

const APP = 'yoga'
const TEN = 't1'

describe('insert', () => {
  it('INSERT en services con defaults aplicados por el repo', async () => {
    const c = mockClient([{ id: 's1' }])
    const r = await repo.insert(c, APP, TEN, { code: 'CONS', name: 'Cons', durationMinutes: 30 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_services\.services/)
    expect(sql).toMatch(/RETURNING \*/)
    expect(params[0]).toBe(APP)
    expect(params[1]).toBe(TEN)
    expect(params[2]).toBeNull()          // subTenantId default
    expect(params[3]).toBe('CONS')        // code
    expect(params[4]).toBe('Cons')        // name
    expect(params[8]).toBe(30)            // durationMinutes
    expect(params[18]).toEqual({})        // metadata default
    expect(params[19]).toBe(true)         // isActive default
    expect(params[20]).toBe('appointment')// kind default
    expect(params[21]).toBe(false)        // publicCatalog default
    expect(r).toEqual({ id: 's1' })
  })

  it('respeta valores explícitos', async () => {
    const c = mockClient([{ id: 's1' }])
    await repo.insert(c, APP, TEN, {
      subTenantId: 'st1', code: 'X', name: 'N', description: 'D', category: 'cat',
      modality: 'online', durationMinutes: 45, bufferBeforeMinutes: 5, bufferAfterMinutes: 10,
      priceCents: 1000, currency: 'USD', cancellationPolicy: { a: 1 },
      requiresIntakeForm: true, intakeFormId: 'if1', capacity: 4, minAge: 18,
      metadata: { m: 1 }, isActive: false, kind: 'class', publicCatalog: true,
      minAdvanceMinutes: 120, maxAdvanceDays: 30,
    })
    const [, params] = c.query.mock.calls[0]
    expect(params).toEqual([
      APP, TEN, 'st1', 'X', 'N', 'D', 'cat', 'online', 45, 5, 10,
      1000, 'USD', { a: 1 }, true, 'if1', 4, 18, { m: 1 }, false, 'class', true,
      120, 30,
    ])
  })
})

describe('findById', () => {
  it('WHERE scope + null cuando no existe', async () => {
    const c = mockClient([])
    expect(await repo.findById(c, APP, TEN, 's9')).toBeNull()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE app_id=\$1 AND tenant_id=\$2 AND id=\$3/)
    expect(params).toEqual([APP, TEN, 's9'])
  })

  it('devuelve la fila cuando existe', async () => {
    const c = mockClient([{ id: 's1' }])
    expect(await repo.findById(c, APP, TEN, 's1')).toEqual({ id: 's1' })
  })
})

describe('listByTenant', () => {
  it('default onlyActive=true sin category', async () => {
    const c = mockClient([])
    await repo.listByTenant(c, APP, TEN)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/is_active = TRUE/)
    expect(sql).toMatch(/ORDER BY name/)
    expect(params).toEqual([APP, TEN])
  })

  it('onlyActive=false omite filtro is_active', async () => {
    const c = mockClient([])
    await repo.listByTenant(c, APP, TEN, { onlyActive: false })
    expect(c.query.mock.calls[0][0]).not.toMatch(/is_active = TRUE/)
  })

  it('category añade filtro parametrizado', async () => {
    const c = mockClient([])
    await repo.listByTenant(c, APP, TEN, { onlyActive: false, category: 'spa' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/category = \$3/)
    expect(params).toEqual([APP, TEN, 'spa'])
  })
})

describe('update', () => {
  it('sin campos → delega a findById (SELECT, no UPDATE)', async () => {
    const c = mockClient([{ id: 's1' }])
    const r = await repo.update(c, APP, TEN, 's1', {})
    expect(c.query.mock.calls[0][0]).toMatch(/SELECT \* FROM platform_services\.services/)
    expect(r).toEqual({ id: 's1' })
  })

  it('con campos → UPDATE + updated_at + RETURNING', async () => {
    const c = mockClient([{ id: 's1', name: 'New' }])
    await repo.update(c, APP, TEN, 's1', { name: 'New', priceCents: 500 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/UPDATE platform_services\.services SET/)
    expect(sql).toMatch(/name = \$4/)
    expect(sql).toMatch(/price_cents = \$5/)
    expect(sql).toMatch(/updated_at = now\(\)/)
    expect(params).toEqual([APP, TEN, 's1', 'New', 500])
  })

  it('null cuando el UPDATE no devuelve fila', async () => {
    const c = mockClient([])
    expect(await repo.update(c, APP, TEN, 's1', { name: 'New' })).toBeNull()
  })
})

describe('deactivate', () => {
  it('UPDATE is_active=FALSE; null si no existe', async () => {
    const c = mockClient([])
    expect(await repo.deactivate(c, APP, TEN, 's1')).toBeNull()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/is_active = FALSE/)
    expect(params).toEqual([APP, TEN, 's1'])
  })
})

describe('categories', () => {
  it('insertCategory con displayOrder default 0', async () => {
    const c = mockClient([{ id: 'c1' }])
    await repo.insertCategory(c, APP, TEN, { name: 'Mains' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_services\.categories/)
    expect(params).toEqual([APP, TEN, 'Mains', 0])
  })

  it('insertCategory respeta displayOrder', async () => {
    const c = mockClient([{ id: 'c1' }])
    await repo.insertCategory(c, APP, TEN, { name: 'Mains', displayOrder: 3 })
    expect(c.query.mock.calls[0][1][3]).toBe(3)
  })

  it('listCategories ordena por display_order, name', async () => {
    const c = mockClient([])
    await repo.listCategories(c, APP, TEN)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/ORDER BY display_order, name/)
    expect(params).toEqual([APP, TEN])
  })
})

describe('images', () => {
  it('listImages scope + orden', async () => {
    const c = mockClient([])
    await repo.listImages(c, APP, TEN, 's1')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/FROM platform_services\.service_images/)
    expect(sql).toMatch(/ORDER BY display_order, created_at/)
    expect(params).toEqual([APP, TEN, 's1'])
  })

  it('insertImage con defaults (altText null, displayOrder 0)', async () => {
    const c = mockClient([{ id: 'img1' }])
    await repo.insertImage(c, APP, TEN, 's1', { objectId: 'o1' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_services\.service_images/)
    expect(params).toEqual([APP, TEN, 's1', 'o1', null, 0])
  })

  it('insertImage respeta altText y displayOrder', async () => {
    const c = mockClient([{ id: 'img1' }])
    await repo.insertImage(c, APP, TEN, 's1', { objectId: 'o1', altText: 'alt', displayOrder: 2 })
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 's1', 'o1', 'alt', 2])
  })

  it('deleteImage true cuando borra, false cuando no', async () => {
    const c = mockClient([], 1)
    expect(await repo.deleteImage(c, APP, TEN, 'img1')).toBe(true)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/DELETE FROM platform_services\.service_images/)
    expect(params).toEqual([APP, TEN, 'img1'])

    const c2 = mockClient([], 0)
    expect(await repo.deleteImage(c2, APP, TEN, 'img1')).toBe(false)
  })
})

describe('pricing tiers', () => {
  it('listPricingTiers scope + orden', async () => {
    const c = mockClient([])
    await repo.listPricingTiers(c, APP, TEN, 's1')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/FROM platform_services\.service_pricing_tiers/)
    expect(sql).toMatch(/ORDER BY created_at/)
    expect(params).toEqual([APP, TEN, 's1'])
  })

  it('insertPricingTier con defaults null', async () => {
    const c = mockClient([{ id: 'pt1' }])
    await repo.insertPricingTier(c, APP, TEN, 's1', { label: 'peak', priceCents: 2000, enabled: true })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_services\.service_pricing_tiers/)
    expect(params).toEqual([APP, TEN, 's1', 'peak', null, null, null, 2000, true])
  })

  it('insertPricingTier respeta days/start/end', async () => {
    const c = mockClient([{ id: 'pt1' }])
    await repo.insertPricingTier(c, APP, TEN, 's1', {
      label: 'wknd', daysOfWeek: [6, 7], startMinute: 600, endMinute: 720,
      priceCents: 3000, enabled: false,
    })
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 's1', 'wknd', [6, 7], 600, 720, 3000, false])
  })

  it('deletePricingTier true/false según rowCount', async () => {
    const c = mockClient([], 1)
    expect(await repo.deletePricingTier(c, APP, TEN, 'pt1')).toBe(true)
    expect(c.query.mock.calls[0][0]).toMatch(/DELETE FROM platform_services\.service_pricing_tiers/)
    const c2 = mockClient([], 0)
    expect(await repo.deletePricingTier(c2, APP, TEN, 'pt1')).toBe(false)
  })
})

describe('insert — booking window defaults', () => {
  it('defaults min_advance_minutes=0 (param 22) and max_advance_days=null (param 23)', async () => {
    const c = mockClient([{ id: 's1' }])
    await repo.insert(c, APP, TEN, { code: 'C', name: 'C', durationMinutes: 30 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/min_advance_minutes, max_advance_days/)
    expect(params[22]).toBe(0)      // minAdvanceMinutes default
    expect(params[23]).toBeNull()   // maxAdvanceDays default
  })
})

describe('translations', () => {
  it('listTranslations: scope + ORDER BY locale', async () => {
    const c = mockClient([{ locale: 'es' }])
    const r = await repo.listTranslations(c, APP, TEN, 's1')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/FROM platform_services\.service_translations/)
    expect(sql).toMatch(/ORDER BY locale/)
    expect(params).toEqual([APP, TEN, 's1'])
    expect(r).toEqual([{ locale: 'es' }])
  })

  it('upsertTranslation: ON CONFLICT upsert with params', async () => {
    const c = mockClient([{ id: 'tr1' }])
    await repo.upsertTranslation(c, APP, TEN, 's1', { locale: 'es', name: 'N', description: 'D' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_services\.service_translations/)
    expect(sql).toMatch(/ON CONFLICT/)
    expect(params).toEqual([APP, TEN, 's1', 'es', 'N', 'D'])
  })

  it('upsertTranslation: null name/description defaults', async () => {
    const c = mockClient([{ id: 'tr1' }])
    await repo.upsertTranslation(c, APP, TEN, 's1', { locale: 'fr' })
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 's1', 'fr', null, null])
  })

  it('deleteTranslation true/false según rowCount', async () => {
    const c = mockClient([], 1)
    expect(await repo.deleteTranslation(c, APP, TEN, 's1', 'es')).toBe(true)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 's1', 'es'])
    const c2 = mockClient([], 0)
    expect(await repo.deleteTranslation(c2, APP, TEN, 's1', 'es')).toBe(false)
  })

  it('translationsForServices: empty ids → empty Map without querying', async () => {
    const c = mockClient([])
    const m = await repo.translationsForServices(c, APP, TEN, [], 'es')
    expect(m.size).toBe(0)
    expect(c.query).not.toHaveBeenCalled()
  })

  it('translationsForServices: builds Map keyed by service_id', async () => {
    const c = mockClient([
      { service_id: 's1', name: 'N1', description: 'D1' },
      { service_id: 's2', name: 'N2', description: 'D2' },
    ])
    const m = await repo.translationsForServices(c, APP, TEN, ['s1', 's2'], 'es')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/= ANY\(\$4::uuid\[\]\)/)
    expect(params).toEqual([APP, TEN, 'es', ['s1', 's2']])
    expect(m.get('s1')).toEqual({ name: 'N1', description: 'D1' })
    expect(m.get('s2')).toEqual({ name: 'N2', description: 'D2' })
  })
})
