import { ForbiddenError } from '@apphub/platform-sdk/errors'
import { pool, withTenantTransaction } from '../lib/db.js'
import * as repo from '../repositories/members.repository.js'

// "me" endpoints — identity comes from req.identity (the JWT). Never
// accept a userId in the URL or body; that would let an attacker probe
// other members' profiles. The tenant context for RLS is also derived
// from the JWT, not from query/body.

export async function getMe(identity) {
  if (!identity?.userId) throw new ForbiddenError()
  return withTenantTransaction(
    pool,
    identity.appId,
    identity.tenantId,
    identity.subTenantId ?? null,
    (client) => repo.findByUserId(client, identity.userId),
  )
}

export async function updateMe(identity, fields) {
  if (!identity?.userId) throw new ForbiddenError()
  return withTenantTransaction(
    pool,
    identity.appId,
    identity.tenantId,
    identity.subTenantId ?? null,
    (client) => repo.upsertProfile(client, {
      userId:      identity.userId,
      appId:       identity.appId,
      tenantId:    identity.tenantId,
      subTenantId: identity.subTenantId ?? null,
      fields,
    }),
  )
}

// Called from the user.revoked event handler. We don't have an
// identity on hand, just the row to delete — the schema-wide service
// role is what authorizes this. Skips RLS by setting the same context
// from the event payload.
export async function deleteMember({ appId, tenantId, subTenantId, userId }) {
  return withTenantTransaction(
    pool,
    appId,
    tenantId,
    subTenantId ?? null,
    (client) => repo.deleteByUserId(client, userId),
  )
}
