// solar-calculator.service — config en apps.metadata.solarCalculator.
// getConfig: 404 si la app no existe; defaults si la key no está seteada.
// setConfig: 404 si la app no existe; devuelve el value persistido.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', DATABASE_URL_TENANTS: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/db.js', () => ({ pool: {}, withTransaction: vi.fn() }))
vi.mock('../repositories/apps.repository.js')

import { getConfig, setConfig, SOLAR_CALCULATOR_DEFAULTS } from '../services/solar-calculator.service.js'
import { withTransaction } from '../lib/db.js'
import * as appsRepo from '../repositories/apps.repository.js'

beforeEach(() => {
  vi.clearAllMocks()
  withTransaction.mockImplementation(async (_p, fn) => fn({}))
})

describe('getConfig', () => {
  it('key undefined (app no existe) → 404', async () => {
    appsRepo.getMetadataKey.mockResolvedValue(undefined)
    await expect(getConfig('nope')).rejects.toThrow(/App/)
  })

  it('key null (sin config) → defaults', async () => {
    appsRepo.getMetadataKey.mockResolvedValue(null)
    expect(await getConfig('aikikan')).toBe(SOLAR_CALCULATOR_DEFAULTS)
  })

  it('config almacenada → la devuelve', async () => {
    const stored = { pricePerKwh: 0.2 }
    appsRepo.getMetadataKey.mockResolvedValue(stored)
    expect(await getConfig('js-electric')).toBe(stored)
  })
})

describe('setConfig', () => {
  it('app no existe → 404', async () => {
    appsRepo.setMetadataKey.mockResolvedValue(null)
    await expect(setConfig('nope', {})).rejects.toThrow(/App/)
  })

  it('persiste y devuelve el value', async () => {
    appsRepo.setMetadataKey.mockResolvedValue({ value: { pricePerKwh: 0.25 } })
    expect(await setConfig('js-electric', { pricePerKwh: 0.25 })).toEqual({ pricePerKwh: 0.25 })
  })
})
