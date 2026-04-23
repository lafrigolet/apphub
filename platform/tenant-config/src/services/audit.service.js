import { withTransaction, pool } from '../lib/db.js'
import * as auditRepo from '../repositories/audit.repository.js'
import { ForbiddenError } from '@apphub/platform-sdk/errors'

export async function listAudit({ appId, tenantId, limit }, identity) {
  // Non-staff callers can only see their own tenant's audit log
  const staffRoles = new Set(['staff', 'super_admin'])
  if (!staffRoles.has(identity?.role)) {
    if (!identity?.tenantId) throw new ForbiddenError('Tenant scope required')
    if (tenantId && tenantId !== identity.tenantId) {
      throw new ForbiddenError('Cannot read audit log for another tenant')
    }
    tenantId = identity.tenantId
  }
  return withTransaction(pool, (client) =>
    auditRepo.list(client, { appId, tenantId, limit }),
  )
}

export async function recordAudit(entry) {
  return withTransaction(pool, (client) => auditRepo.insert(client, entry))
}
