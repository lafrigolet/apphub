import { env } from '../lib/env.js'
import { logger } from '../lib/logger.js'
import * as presence from './presence.service.js'

// Resolve the set of user ids a message mentions. Combines four sources, all
// intersected with the conversation's active participants (you can't mention
// someone who isn't in the room):
//   - input.mentions:       explicit user ids
//   - input.mentionScope:   'all' (everyone) | 'here' (currently online)
//   - input.mentionRoles:   conversation roles, e.g. ['owner','admin','agent']
//                           — fully local, works for any caller
//   - input.mentionAppRoles: platform roles, e.g. ['staff'] — resolved via
//                           platform/auth over HTTP (rule 13). Only works when
//                           the caller is staff/admin (auth gates the endpoint);
//                           otherwise it resolves to nothing (best-effort).
export async function resolve({ ctx, participants, input, bearerToken }) {
  const active = participants.filter((p) => !p.left_at)
  const activeIds = new Set(active.map((p) => p.user_id))
  const out = new Set()

  for (const u of input.mentions ?? []) {
    if (activeIds.has(u)) out.add(u)
  }

  if (input.mentionScope === 'all') {
    active.forEach((p) => out.add(p.user_id))
  } else if (input.mentionScope === 'here') {
    const snap = await presence.snapshot(ctx, [...activeIds])
    snap.filter((s) => s.status !== 'offline').forEach((s) => out.add(s.userId))
  }

  if (input.mentionRoles?.length) {
    const wanted = new Set(input.mentionRoles)
    active.filter((p) => wanted.has(p.role)).forEach((p) => out.add(p.user_id))
  }

  if (input.mentionAppRoles?.length) {
    const byRole = await resolveAppRoleUsers(ctx, input.mentionAppRoles, bearerToken)
    byRole.filter((id) => activeIds.has(id)).forEach((id) => out.add(id))
  }

  out.delete(ctx.userId) // never notify yourself
  return [...out]
}

// Calls platform-core's own /v1/users API (loopback) forwarding the caller's
// bearer token. Returns [] on any failure (incl. 403 for non-staff callers).
async function resolveAppRoleUsers(ctx, roles, bearerToken) {
  if (!bearerToken) return []
  try {
    const url = `${env.PLATFORM_CORE_BASE_URL}/v1/users?tenantId=${encodeURIComponent(ctx.tenantId)}`
      + `&appId=${encodeURIComponent(ctx.appId)}&role=${encodeURIComponent(roles.join(','))}`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${bearerToken}` } })
    if (!res.ok) return []
    const json = await res.json().catch(() => null)
    const users = Array.isArray(json) ? json : (json?.data ?? [])
    return users.map((u) => u.id).filter(Boolean)
  } catch (err) {
    logger.warn({ err }, 'app-role mention resolution failed')
    return []
  }
}
