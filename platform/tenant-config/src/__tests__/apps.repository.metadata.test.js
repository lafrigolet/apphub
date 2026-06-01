// apps.repository — getMetadataKey / setMetadataKey (subtree metadata[key]).
// Distingue app inexistente (undefined) de clave no seteada (null), y valida
// el jsonb_set idempotente del setter.
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/apps.repository.js'

function mockClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

describe('getMetadataKey', () => {
  it('app inexistente (0 rows) → undefined', async () => {
    const c = mockClient([])
    expect(await repo.getMetadataKey(c, 'nope', 'solarCalculator')).toBeUndefined()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/metadata -> \$2 AS value/)
    expect(params).toEqual(['nope', 'solarCalculator'])
  })

  it('clave no seteada (value null) → null', async () => {
    const c = mockClient([{ value: null }])
    expect(await repo.getMetadataKey(c, 'aikikan', 'solarCalculator')).toBeNull()
  })

  it('clave seteada → devuelve el value', async () => {
    const c = mockClient([{ value: { pricePerKwh: 0.2 } }])
    expect(await repo.getMetadataKey(c, 'js-electric', 'solarCalculator')).toEqual({ pricePerKwh: 0.2 })
  })
})

describe('setMetadataKey', () => {
  it('jsonb_set con value serializado; devuelve el subtree', async () => {
    const c = mockClient([{ app_id: 'js-electric', value: { pricePerKwh: 0.25 } }])
    const r = await repo.setMetadataKey(c, 'js-electric', 'solarCalculator', { pricePerKwh: 0.25 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/jsonb_set\(metadata, ARRAY\[\$2\]::text\[\], \$3::jsonb, true\)/)
    expect(params).toEqual(['js-electric', 'solarCalculator', JSON.stringify({ pricePerKwh: 0.25 })])
    expect(r.value).toEqual({ pricePerKwh: 0.25 })
  })

  it('app inexistente → null', async () => {
    expect(await repo.setMetadataKey(mockClient([]), 'nope', 'k', {})).toBeNull()
  })
})
