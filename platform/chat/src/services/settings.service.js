import { withTenantTransaction } from '../lib/db.js'
import { requireStaff } from './guards.js'
import * as repo from '../repositories/settings.repository.js'

// Defaults applied when a tenant has not configured chat yet. Member chat
// ships permissive: groups allowed, redaction OFF (it's internal chat, not
// anti-disintermediation like the marketplace messaging module).
export const DEFAULT_SETTINGS = {
  app_id: null,
  tenant_id: null,
  allow_groups: true,
  max_group_size: 256,
  redaction_enabled: false,
  retention_days: null,
  support_enabled: true,
}

// Resolve effective settings inside an existing tenant transaction.
export async function resolve(client, appId, tenantId) {
  const row = await repo.find(client, appId, tenantId)
  return row ?? { ...DEFAULT_SETTINGS, app_id: appId, tenant_id: tenantId }
}

export async function getForTenant(identity) {
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId ?? null, (c) =>
    resolve(c, identity.appId, identity.tenantId),
  )
}

export async function upsertForTenant(identity, input) {
  requireStaff(identity)
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId ?? null, (c) =>
    repo.upsert(c, identity.appId, identity.tenantId, input),
  )
}
