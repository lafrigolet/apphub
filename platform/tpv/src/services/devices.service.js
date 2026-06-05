import { NotFoundError, ConflictError } from '@apphub/platform-sdk/errors'
import { withTenantTransaction } from '../lib/db.js'
import * as devicesRepo from '../repositories/devices.repository.js'

export async function createDevice(identity, body) {
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId, async (c) => {
    try {
      return await devicesRepo.insert(c, {
        appId: identity.appId,
        tenantId: identity.tenantId,
        subTenantId: identity.subTenantId ?? null,
        name: body.name,
        location: body.location,
        defaultSeriesId: body.defaultSeriesId,
        metadata: body.metadata,
      })
    } catch (err) {
      if (err.code === '23505') throw new ConflictError(`Device name already exists: ${body.name}`)
      throw err
    }
  })
}

export async function listDevices(identity, { active } = {}) {
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId, (c) =>
    devicesRepo.list(c, { active }))
}

export async function getDevice(identity, id) {
  const device = await withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId, (c) =>
    devicesRepo.findById(c, id))
  if (!device) throw new NotFoundError('Device not found')
  return device
}

export async function updateDevice(identity, id, patch) {
  const device = await withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId, (c) =>
    devicesRepo.update(c, id, patch))
  if (!device) throw new NotFoundError('Device not found')
  return device
}

export async function deactivateDevice(identity, id) {
  const device = await withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId, (c) =>
    devicesRepo.update(c, id, { active: false }))
  if (!device) throw new NotFoundError('Device not found')
  return device
}
