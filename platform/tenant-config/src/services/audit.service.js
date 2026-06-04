import { withTransaction, pool } from '../lib/db.js'
import * as auditRepo from '../repositories/audit.repository.js'
import { ForbiddenError } from '@apphub/platform-sdk/errors'

export async function listAudit({ appId, tenantId, limit, before }, identity) {
  // Non-staff callers can only see their own tenant's audit log
  const staffRoles = new Set(['staff', 'super_admin'])
  if (!staffRoles.has(identity?.role)) {
    if (!identity?.tenantId) throw new ForbiddenError('Tenant scope required')
    if (tenantId && tenantId !== identity.tenantId) {
      throw new ForbiddenError('Cannot read audit log for another tenant')
    }
    tenantId = identity.tenantId
  }
  // Response shape stays a plain array for backward compatibility. The keyset
  // cursor (#10) is opt-in via the `before` query param; callers paginate by
  // passing the `ts` of the last row of the previous page. When omitted, the
  // behaviour is unchanged (most recent page).
  return withTransaction(pool, (client) =>
    auditRepo.list(client, { appId, tenantId, limit, before }),
  )
}

export async function recordAudit(entry) {
  return withTransaction(pool, (client) => auditRepo.insert(client, entry))
}
