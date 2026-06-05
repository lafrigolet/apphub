import { ConflictError } from '@apphub/platform-sdk/errors'
import { withTenantTransaction } from '../lib/db.js'
import * as seriesRepo from '../repositories/number-series.repository.js'

export async function createSeries(identity, body) {
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId, async (c) => {
    try {
      return await seriesRepo.insert(c, {
        appId: identity.appId,
        tenantId: identity.tenantId,
        subTenantId: identity.subTenantId ?? null,
        code: body.code,
        kind: body.kind,
        prefix: body.prefix,
        deviceId: body.deviceId,
      })
    } catch (err) {
      if (err.code === '23505') throw new ConflictError(`Series code already exists: ${body.code}`)
      throw err
    }
  })
}

export async function listSeries(identity, { kind, active } = {}) {
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId, (c) =>
    seriesRepo.list(c, { kind, active }))
}
