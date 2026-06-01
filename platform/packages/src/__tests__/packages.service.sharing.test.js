// packages.service — cobertura de sharing / transfer / renew + guards de redeem.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn() },
  withTenantTransaction: vi.fn(),
}))
vi.mock('../lib/redis.js', () => ({
  publish: vi.fn(),
  subscribe: vi.fn(),
}))
vi.mock('../repositories/packages.repository.js')

import * as service from '../services/packages.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/packages.repository.js'
import { ConflictError, NotFoundError } from '@apphub/platform-sdk/errors'

const APP = 'yoga'
const TEN = 't1'
const PKG = 'pkg1'
const USER = 'owner'
const OTHER = 'other'

const ownerCtx = { appId: APP, tenantId: TEN, subTenantId: null, userId: USER, role: 'buyer' }
const staffCtx = { appId: APP, tenantId: TEN, subTenantId: null, userId: 'admin', role: 'staff' }

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
})

describe('listTemplates / listPurchases', () => {
  it('listTemplates delega en el repo', async () => {
    repo.listTemplates.mockResolvedValue([{ id: 'tpl1' }])
    expect(await service.listTemplates(ownerCtx, { onlyActive: true })).toEqual([{ id: 'tpl1' }])
    expect(repo.listTemplates).toHaveBeenCalledWith(expect.anything(), APP, TEN, { onlyActive: true })
  })

  it('listPurchases delega en el repo', async () => {
    repo.listPurchasesForClient.mockResolvedValue([{ id: PKG }])
    expect(await service.listPurchases(ownerCtx, USER, { onlyActive: false })).toEqual([{ id: PKG }])
    expect(repo.listPurchasesForClient).toHaveBeenCalledWith(expect.anything(), APP, TEN, USER, { onlyActive: false })
  })
})

describe('redeem — guards de autorización', () => {
  it('system ctx bypassa el guard', async () => {
    repo.decrementSessions.mockResolvedValue({ id: PKG, status: 'active', client_user_id: USER })
    repo.insertRedemption.mockResolvedValue()
    await service.redeem({ ...ownerCtx, role: 'system' }, { packageId: PKG })
    expect(repo.findPurchaseById).not.toHaveBeenCalled()
  })

  it('staff ctx bypassa el guard', async () => {
    repo.decrementSessions.mockResolvedValue({ id: PKG, status: 'active', client_user_id: USER })
    repo.insertRedemption.mockResolvedValue()
    await service.redeem(staffCtx, { packageId: PKG })
    expect(repo.findPurchaseById).not.toHaveBeenCalled()
  })

  it('NotFoundError cuando el package no existe', async () => {
    repo.findPurchaseById.mockResolvedValue(null)
    await expect(service.redeem(ownerCtx, { packageId: PKG })).rejects.toThrow(NotFoundError)
  })

  it('usuario autorizado (no dueño) puede redimir', async () => {
    repo.findPurchaseById.mockResolvedValue({ id: PKG, client_user_id: OTHER })
    repo.isAuthorized.mockResolvedValue(true)
    repo.decrementSessions.mockResolvedValue({ id: PKG, status: 'active', client_user_id: OTHER })
    repo.insertRedemption.mockResolvedValue()
    await service.redeem(ownerCtx, { packageId: PKG })
    expect(repo.decrementSessions).toHaveBeenCalled()
  })

  it('usuario no autorizado → ConflictError', async () => {
    repo.findPurchaseById.mockResolvedValue({ id: PKG, client_user_id: OTHER })
    repo.isAuthorized.mockResolvedValue(false)
    await expect(service.redeem(ownerCtx, { packageId: PKG })).rejects.toThrow(ConflictError)
  })
})

describe('listAuthorizedUsers', () => {
  it('devuelve la lista cuando el package existe', async () => {
    repo.findPurchaseById.mockResolvedValue({ id: PKG, client_user_id: USER })
    repo.listAuthorizedUsers.mockResolvedValue([{ user_id: OTHER }])
    expect(await service.listAuthorizedUsers(ownerCtx, PKG)).toEqual([{ user_id: OTHER }])
  })

  it('NotFoundError cuando el package no existe', async () => {
    repo.findPurchaseById.mockResolvedValue(null)
    await expect(service.listAuthorizedUsers(ownerCtx, PKG)).rejects.toThrow(NotFoundError)
  })
})

describe('addAuthorizedUser', () => {
  it('el dueño puede compartir', async () => {
    repo.findPurchaseById.mockResolvedValue({ id: PKG, client_user_id: USER })
    repo.addAuthorizedUser.mockResolvedValue({ user_id: OTHER })
    await service.addAuthorizedUser(ownerCtx, PKG, { userId: OTHER, displayName: 'X' })
    expect(repo.addAuthorizedUser).toHaveBeenCalledWith(
      expect.anything(), APP, TEN, PKG,
      expect.objectContaining({ userId: OTHER, displayName: 'X', addedBy: USER }),
    )
  })

  it('staff puede compartir aunque no sea dueño', async () => {
    repo.findPurchaseById.mockResolvedValue({ id: PKG, client_user_id: OTHER })
    repo.addAuthorizedUser.mockResolvedValue({})
    await service.addAuthorizedUser(staffCtx, PKG, { userId: 'z' })
    expect(repo.addAuthorizedUser).toHaveBeenCalled()
  })

  it('no-dueño no-staff → ConflictError', async () => {
    repo.findPurchaseById.mockResolvedValue({ id: PKG, client_user_id: OTHER })
    await expect(service.addAuthorizedUser(ownerCtx, PKG, { userId: 'z' })).rejects.toThrow(ConflictError)
  })

  it('NotFoundError cuando el package no existe', async () => {
    repo.findPurchaseById.mockResolvedValue(null)
    await expect(service.addAuthorizedUser(ownerCtx, PKG, { userId: 'z' })).rejects.toThrow(NotFoundError)
  })
})

describe('removeAuthorizedUser', () => {
  it('el dueño puede revocar', async () => {
    repo.findPurchaseById.mockResolvedValue({ id: PKG, client_user_id: USER })
    repo.removeAuthorizedUser.mockResolvedValue(true)
    await service.removeAuthorizedUser(ownerCtx, PKG, OTHER)
    expect(repo.removeAuthorizedUser).toHaveBeenCalledWith(expect.anything(), APP, TEN, PKG, OTHER)
  })

  it('no-dueño no-staff → ConflictError', async () => {
    repo.findPurchaseById.mockResolvedValue({ id: PKG, client_user_id: OTHER })
    await expect(service.removeAuthorizedUser(ownerCtx, PKG, 'z')).rejects.toThrow(ConflictError)
  })

  it('NotFoundError cuando el package no existe', async () => {
    repo.findPurchaseById.mockResolvedValue(null)
    await expect(service.removeAuthorizedUser(ownerCtx, PKG, 'z')).rejects.toThrow(NotFoundError)
  })

  it('NotFoundError cuando el authorized user no existía', async () => {
    repo.findPurchaseById.mockResolvedValue({ id: PKG, client_user_id: USER })
    repo.removeAuthorizedUser.mockResolvedValue(false)
    await expect(service.removeAuthorizedUser(ownerCtx, PKG, 'z')).rejects.toThrow(NotFoundError)
  })
})

describe('transferPackage', () => {
  it('transfiere y publica package.transferred (kind default transfer)', async () => {
    repo.findPurchaseById.mockResolvedValue({ id: PKG, client_user_id: USER })
    repo.transferOwnership.mockResolvedValue({ package: { id: PKG }, transfer: { id: 'tr1' } })
    const r = await service.transferPackage(ownerCtx, PKG, { toUserId: OTHER })
    expect(repo.transferOwnership).toHaveBeenCalledWith(
      expect.anything(), APP, TEN, PKG, USER, OTHER, 'transfer', undefined, USER,
    )
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'package.transferred' }))
    expect(r.transfer.id).toBe('tr1')
  })

  it('kind=gift se propaga', async () => {
    repo.findPurchaseById.mockResolvedValue({ id: PKG, client_user_id: USER })
    repo.transferOwnership.mockResolvedValue({ package: {}, transfer: {} })
    await service.transferPackage(ownerCtx, PKG, { toUserId: OTHER, kind: 'gift' })
    expect(repo.transferOwnership.mock.calls[0][6]).toBe('gift')
  })

  it('NotFoundError cuando el package no existe', async () => {
    repo.findPurchaseById.mockResolvedValue(null)
    await expect(service.transferPackage(ownerCtx, PKG, { toUserId: OTHER })).rejects.toThrow(NotFoundError)
  })

  it('no-dueño no-staff → ConflictError', async () => {
    repo.findPurchaseById.mockResolvedValue({ id: PKG, client_user_id: OTHER })
    await expect(service.transferPackage(ownerCtx, PKG, { toUserId: 'z' })).rejects.toThrow(ConflictError)
  })

  it('transferir al mismo dueño → ConflictError', async () => {
    repo.findPurchaseById.mockResolvedValue({ id: PKG, client_user_id: USER })
    await expect(service.transferPackage(ownerCtx, PKG, { toUserId: USER })).rejects.toThrow(ConflictError)
  })

  it('transferOwnership null (cambio concurrente) → ConflictError', async () => {
    repo.findPurchaseById.mockResolvedValue({ id: PKG, client_user_id: USER })
    repo.transferOwnership.mockResolvedValue(null)
    await expect(service.transferPackage(ownerCtx, PKG, { toUserId: OTHER })).rejects.toThrow(ConflictError)
  })
})

describe('listTransfers', () => {
  it('delega en el repo', async () => {
    repo.listTransfers.mockResolvedValue([{ id: 'tr1' }])
    expect(await service.listTransfers(ownerCtx, PKG)).toEqual([{ id: 'tr1' }])
    expect(repo.listTransfers).toHaveBeenCalledWith(expect.anything(), APP, TEN, PKG)
  })
})

describe('setAutoRenew', () => {
  it('el dueño puede alternar', async () => {
    repo.findPurchaseById.mockResolvedValue({ id: PKG, client_user_id: USER })
    repo.setAutoRenew.mockResolvedValue({ id: PKG, auto_renew: true })
    await service.setAutoRenew(ownerCtx, PKG, true)
    expect(repo.setAutoRenew).toHaveBeenCalledWith(expect.anything(), APP, TEN, PKG, true)
  })

  it('no-dueño no-staff → ConflictError', async () => {
    repo.findPurchaseById.mockResolvedValue({ id: PKG, client_user_id: OTHER })
    await expect(service.setAutoRenew(ownerCtx, PKG, true)).rejects.toThrow(ConflictError)
  })

  it('NotFoundError cuando el package no existe', async () => {
    repo.findPurchaseById.mockResolvedValue(null)
    await expect(service.setAutoRenew(ownerCtx, PKG, true)).rejects.toThrow(NotFoundError)
  })
})

describe('renewPackage', () => {
  it('renueva y publica package.renewed', async () => {
    repo.findPurchaseById.mockResolvedValue({ id: PKG, client_user_id: USER, template_id: 'tpl1' })
    repo.findTemplateById.mockResolvedValue({ id: 'tpl1' })
    repo.insertRenewal.mockResolvedValue({ id: 'new1', client_user_id: USER })
    const r = await service.renewPackage(ownerCtx, PKG)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'package.renewed' }))
    expect(r.id).toBe('new1')
  })

  it('role system puede renovar', async () => {
    repo.findPurchaseById.mockResolvedValue({ id: PKG, client_user_id: OTHER, template_id: 'tpl1' })
    repo.findTemplateById.mockResolvedValue({ id: 'tpl1' })
    repo.insertRenewal.mockResolvedValue({ id: 'new1', client_user_id: OTHER })
    await service.renewPackage({ ...ownerCtx, role: 'system' }, PKG)
    expect(repo.insertRenewal).toHaveBeenCalled()
  })

  it('NotFoundError cuando el package no existe', async () => {
    repo.findPurchaseById.mockResolvedValue(null)
    await expect(service.renewPackage(ownerCtx, PKG)).rejects.toThrow(NotFoundError)
  })

  it('no-dueño no-staff → ConflictError', async () => {
    repo.findPurchaseById.mockResolvedValue({ id: PKG, client_user_id: OTHER, template_id: 'tpl1' })
    await expect(service.renewPackage(ownerCtx, PKG)).rejects.toThrow(ConflictError)
  })

  it('NotFoundError cuando el template no existe', async () => {
    repo.findPurchaseById.mockResolvedValue({ id: PKG, client_user_id: USER, template_id: 'tpl1' })
    repo.findTemplateById.mockResolvedValue(null)
    await expect(service.renewPackage(ownerCtx, PKG)).rejects.toThrow(NotFoundError)
  })
})

describe('handleEvent — branches restantes', () => {
  it('ignora eventos sin appId/tenantId/bookingId', async () => {
    await service.handleEvent({ type: 'booking.completed', payload: {} })
    expect(withTenantTransaction).not.toHaveBeenCalled()
  })

  it('booking.no_show refunda', async () => {
    withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => {
      const c = mockClient()
      c.query.mockResolvedValueOnce({ rows: [{ package_id: PKG }] })
      return fn(c)
    })
    repo.decrementSessions.mockResolvedValue({})
    repo.insertRedemption.mockResolvedValue()
    await service.handleEvent({ type: 'booking.no_show', payload: { appId: APP, tenantId: TEN, bookingId: 'b1' } })
    expect(repo.decrementSessions).toHaveBeenCalledWith(expect.anything(), APP, TEN, PKG, +1)
  })

  it('tipo de evento desconocido no muta nada', async () => {
    withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => {
      const c = mockClient()
      c.query.mockResolvedValueOnce({ rows: [{ package_id: PKG }] })
      return fn(c)
    })
    await service.handleEvent({ type: 'booking.weird', payload: { appId: APP, tenantId: TEN, bookingId: 'b1' } })
    expect(repo.decrementSessions).not.toHaveBeenCalled()
  })
})
