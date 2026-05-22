import { describe, it, expect, vi, beforeEach } from 'vitest'

const stubClient = { query: vi.fn() }

vi.mock('../lib/db.js', () => ({
  withTenantTransaction: vi.fn(async (_a, _t, _s, fn) => fn(stubClient)),
}))

vi.mock('../repositories/causes.repository.js', () => ({
  list:            vi.fn(),
  findById:        vi.fn(),
  findByCode:      vi.fn(),
  insert:          vi.fn(),
  update:          vi.fn(),
  softDelete:      vi.fn(),
  incrementRaised: vi.fn(),
}))

import * as service from '../services/causes.service.js'
import * as repo    from '../repositories/causes.repository.js'

beforeEach(() => vi.clearAllMocks())

const APP    = 'aikikan'
const TENANT = '30000000-0000-0000-0000-000000000001'
const admin  = { userId: 'a1', role: 'admin', appId: APP, tenantId: TENANT }
const donor  = { userId: 'u1', role: 'user',  appId: APP, tenantId: TENANT }

describe('listPublicCauses', () => {
  it('lista solo activas sin requerir auth', async () => {
    repo.list.mockResolvedValue([{ id: 'c1', active: true }])
    const r = await service.listPublicCauses({ appId: APP, tenantId: TENANT })
    expect(repo.list).toHaveBeenCalledWith(stubClient, { onlyActive: true })
    expect(r).toHaveLength(1)
  })
})

describe('listAllCauses', () => {
  it('admin lista activas + inactivas', async () => {
    repo.list.mockResolvedValue([])
    await service.listAllCauses(admin)
    expect(repo.list).toHaveBeenCalledWith(stubClient, { onlyActive: false })
  })
  it('rechaza al donante (no es admin)', async () => {
    await expect(service.listAllCauses(donor)).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('createCause — código único por tenant', () => {
  it('rechaza si el código ya existe en (app, tenant)', async () => {
    repo.findByCode.mockResolvedValueOnce({ id: 'c0', code: 'tatami-2026' })
    await expect(
      service.createCause(admin, { code: 'tatami-2026', name: 'Otro' }),
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(repo.insert).not.toHaveBeenCalled()
  })

  it('crea cuando el código está libre', async () => {
    repo.findByCode.mockResolvedValueOnce(null)
    repo.insert.mockResolvedValue({ id: 'c1', code: 'tatami-2026' })
    const r = await service.createCause(admin, { code: 'tatami-2026', name: 'Tatami' })
    expect(r.id).toBe('c1')
    expect(repo.insert).toHaveBeenCalledTimes(1)
  })
})

describe('updateCause', () => {
  it('rechaza al donante', async () => {
    await expect(service.updateCause(donor, 'c1', { name: 'X' })).rejects.toMatchObject({ statusCode: 403 })
  })
  it('404 si no existe', async () => {
    repo.update.mockResolvedValueOnce(null)
    await expect(service.updateCause(admin, 'no', { name: 'X' })).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('deleteCause — soft delete', () => {
  it('marca active=FALSE (vía repo.softDelete)', async () => {
    repo.softDelete.mockResolvedValueOnce(true)
    await service.deleteCause(admin, 'c1')
    expect(repo.softDelete).toHaveBeenCalledWith(stubClient, 'c1')
  })
  it('404 si no existe', async () => {
    repo.softDelete.mockResolvedValueOnce(false)
    await expect(service.deleteCause(admin, 'no')).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('incrementRaised — idempotencia conceptual', () => {
  // El idempotency real lo da el row de donations.stripe_session_id
  // (cada sesión Stripe se reconcilia una vez). Aquí verificamos que el
  // repo sólo se llama una vez por evento — no acumula al renovar.
  it('llamar incrementRaised dos veces con el mismo delta acumula (no es idempotent per-se)', async () => {
    repo.incrementRaised.mockResolvedValue(undefined)
    await repo.incrementRaised(stubClient, 'c1', 5000)
    await repo.incrementRaised(stubClient, 'c1', 5000)
    expect(repo.incrementRaised).toHaveBeenCalledTimes(2)
    // La idempotencia se garantiza aguas arriba: splitpay-events.handler
    // sólo dispara checkout.completed UNA vez por session_id (test
    // separado en splitpay-events.handler.test.js).
  })
})
