import { ForbiddenError, NotFoundError } from '@apphub/platform-sdk/errors'
import { pool, withTenantTransaction } from '../lib/db.js'
import * as repo from '../repositories/members.repository.js'

const ADMIN_ROLES = new Set(['owner', 'admin', 'staff', 'super_admin'])

function requireAdmin(identity) {
  if (!identity?.userId) throw new ForbiddenError()
  if (!ADMIN_ROLES.has(identity.role)) throw new ForbiddenError('Only owner/admin can manage members')
}

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

// ── Admin endpoints: trabajan sobre el tenant del caller (RLS scope),
//    pero contra cualquier user_id de ese tenant. La regla de rol la
//    aplica `requireAdmin`; la regla de tenant la fuerza el RLS.

export async function listMembers(identity) {
  requireAdmin(identity)
  return withTenantTransaction(
    pool,
    identity.appId,
    identity.tenantId,
    identity.subTenantId ?? null,
    (client) => repo.findAll(client),
  )
}

export async function getMemberByUserId(identity, userId) {
  requireAdmin(identity)
  return withTenantTransaction(
    pool,
    identity.appId,
    identity.tenantId,
    identity.subTenantId ?? null,
    async (client) => {
      const row = await repo.findByUserId(client, userId)
      if (!row) throw new NotFoundError('Member')
      return row
    },
  )
}

export async function updateMemberAdmin(identity, userId, fields) {
  requireAdmin(identity)
  return withTenantTransaction(
    pool,
    identity.appId,
    identity.tenantId,
    identity.subTenantId ?? null,
    (client) => repo.upsertProfile(client, {
      userId,
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
