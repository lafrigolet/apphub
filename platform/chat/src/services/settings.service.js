import { withTenantTransaction } from '../lib/db.js'
import { ValidationError } from '@apphub/platform-sdk/errors'
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
  dm_requests: false,
  max_attachment_mb: null,
  allowed_attachment_kinds: null,
  banned_words: null,
  sla_minutes_low: null,
  sla_minutes_normal: null,
  sla_minutes_high: null,
  sla_minutes_urgent: null,
  search_language: 'simple',
  support_auto_reply: null,
}

// Postgres text-search regconfigs we let tenants pick for message search.
// Kept conservative so a typo can't break the FTS query (regconfig cast).
export const SEARCH_LANGUAGES = ['simple', 'spanish', 'english']

// Effective SLA threshold (minutes) for a support priority, falling back to a
// caller-supplied default when the tenant hasn't configured that priority.
export function slaMinutesFor(settings, priority, fallback) {
  const col = {
    low: 'sla_minutes_low', normal: 'sla_minutes_normal',
    high: 'sla_minutes_high', urgent: 'sla_minutes_urgent',
  }[priority]
  const v = col ? settings?.[col] : null
  return v ?? fallback
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
  if (input.searchLanguage && !SEARCH_LANGUAGES.includes(input.searchLanguage)) {
    throw new ValidationError(`searchLanguage must be one of: ${SEARCH_LANGUAGES.join(', ')}`)
  }
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId ?? null, (c) =>
    repo.upsert(c, identity.appId, identity.tenantId, input),
  )
}
