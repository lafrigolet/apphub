// addresses.service — default-origin uniqueness ordering (clear BEFORE
// insert/update) and EasyPost verify/normalize. Repos + EasyPost lib mocked.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../lib/db.js', () => ({
  pool: {},
  withTenantTransaction: vi.fn(async (_p, _a, _t, _s, fn) => fn({})),
}))
vi.mock('../repositories/addresses.repository.js', () => ({
  insertAddress: vi.fn(),
  listAddresses: vi.fn(),
  findAddressById: vi.fn(),
  findDefaultOrigin: vi.fn(),
  updateAddress: vi.fn(),
  clearDefaultOrigin: vi.fn(),
  deleteAddress: vi.fn(),
}))
vi.mock('../lib/easypost.js', () => ({ verifyAddress: vi.fn() }))

import { createAddress, updateAddress, verifyAddress } from '../services/addresses.service.js'
import * as repo from '../repositories/addresses.repository.js'
import * as easypost from '../lib/easypost.js'

const ctx = { appId: 'shop', tenantId: '22222222-2222-2222-2222-222222222222', subTenantId: null }

beforeEach(() => vi.clearAllMocks())

describe('createAddress — default origin', () => {
  it('clears existing default origin BEFORE inserting a new default origin', async () => {
    const order = []
    repo.clearDefaultOrigin.mockImplementation(async () => order.push('clear'))
    repo.insertAddress.mockImplementation(async () => { order.push('insert'); return { id: 'a1' } })
    await createAddress(ctx, { role: 'origin', isDefault: true, street1: 'x', city: 'y', country: 'US' })
    expect(order).toEqual(['clear', 'insert'])
  })

  it('does not clear when the address is not a default origin', async () => {
    repo.insertAddress.mockResolvedValue({ id: 'a1' })
    await createAddress(ctx, { role: 'destination', street1: 'x', city: 'y', country: 'US' })
    expect(repo.clearDefaultOrigin).not.toHaveBeenCalled()
  })
})

describe('updateAddress — promote to default', () => {
  it('demotes others (keeping this id) BEFORE the update', async () => {
    const order = []
    repo.clearDefaultOrigin.mockImplementation(async (_c, _a, _t, id) => order.push(`clear:${id}`))
    repo.updateAddress.mockImplementation(async () => { order.push('update'); return { id: 'a1' } })
    await updateAddress(ctx, 'a1', { isDefault: true })
    expect(order).toEqual(['clear:a1', 'update'])
  })
})

describe('verifyAddress', () => {
  it('adopts EasyPost normalized fields + caches address id on success', async () => {
    repo.findAddressById.mockResolvedValue({ id: 'a1', street1: '1 a st', city: 'nyc', country: 'US' })
    easypost.verifyAddress.mockResolvedValue({
      id: 'adr_ep', street1: '1 A ST', city: 'NEW YORK', state: 'NY', zip: '10001', country: 'US',
      verifications: { delivery: { success: true } },
    })
    repo.updateAddress.mockImplementation(async (_c, _a, _t, _id, patch) => ({ id: 'a1', ...patch }))
    const out = await verifyAddress(ctx, 'a1')
    const patch = repo.updateAddress.mock.calls[0][4]
    expect(patch).toMatchObject({ verified: true, easypostAddressId: 'adr_ep', region: 'NY', zip: '10001' })
    expect(out.verification).toEqual({ success: true })
  })

  it('marks unverified without overwriting fields on failure', async () => {
    repo.findAddressById.mockResolvedValue({ id: 'a1', street1: '1 a st', city: 'nyc', country: 'US' })
    easypost.verifyAddress.mockResolvedValue({ id: 'adr_ep', verifications: { delivery: { success: false, errors: [] } } })
    repo.updateAddress.mockImplementation(async (_c, _a, _t, _id, patch) => ({ id: 'a1', ...patch }))
    await verifyAddress(ctx, 'a1')
    const patch = repo.updateAddress.mock.calls[0][4]
    expect(patch.verified).toBe(false)
    expect(patch.region).toBeUndefined()   // no normalized fields adopted
  })
})
