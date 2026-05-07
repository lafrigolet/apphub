import { pool } from '../lib/db.js'
import * as userRepo from '../repositories/user.repository.js'
import { ForbiddenError, NotFoundError } from '../utils/errors.js'

const STAFF_ROLES = new Set(['staff', 'super_admin'])

function isStaff(identity) {
  return STAFF_ROLES.has(identity?.role)
}

async function withStaffContext(fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // The default RLS policy casts app.tenant_id to uuid; seed valid (but
    // non-matching) values so the policy expression evaluates without error.
    // The staff_access policy is the one that actually grants visibility.
    await client.query(`SELECT set_config('app.app_id',       '__staff__',                                  true)`)
    await client.query(`SELECT set_config('app.tenant_id',    '00000000-0000-0000-0000-000000000000',       true)`)
    await client.query(`SELECT set_config('app.staff_access', 'true',                                       true)`)
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

async function withTenantContext(appId, tenantId, fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`SELECT set_config('app.app_id',    $1, true)`, [appId])
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId])
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

export async function listUsers({ appId, tenantId, role }, identity) {
  if (!isStaff(identity)) {
    // Non-staff can only list users in their own (app, tenant) scope
    if ((appId && appId !== identity.appId) || (tenantId && tenantId !== identity.tenantId)) {
      throw new ForbiddenError('Can only list users in your own tenant')
    }
    appId    = identity.appId
    tenantId = identity.tenantId
  }
  if (!appId || !tenantId) {
    if (!isStaff(identity)) throw new ForbiddenError('appId and tenantId required')
    return withStaffContext((client) => userRepo.list(client, { appId, tenantId, role }))
  }
  const runner = isStaff(identity) ? withStaffContext : (fn) => withTenantContext(appId, tenantId, fn)
  return runner((client) => userRepo.list(client, { appId, tenantId, role }))
}

export async function changeRole({ id, role }, identity) {
  if (!identity?.userId) throw new ForbiddenError()
  if (id === identity.userId) throw new ForbiddenError('Cannot change your own role')

  return withStaffContext(async (client) => {
    const target = await userRepo.findAnywhereById(client, id)
    if (!target) throw new NotFoundError('User')

    // Staff can change any user's role. Non-staff can only change users in their own tenant.
    if (!isStaff(identity) && (target.app_id !== identity.appId || target.tenant_id !== identity.tenantId)) {
      throw new ForbiddenError('Cannot change role of a user outside your tenant')
    }
    const updated = await userRepo.updateRole(client, id, role)
    return updated
  })
}

// Self-service: cualquier usuario autenticado puede leer/actualizar su
// propio perfil. El JWT (req.identity) es la única fuente de verdad sobre
// quién es; ningún parámetro lo identifica.
export async function getMe(identity) {
  if (!identity?.userId) throw new ForbiddenError()
  return withStaffContext(async (client) => {
    const user = await userRepo.findAnywhereById(client, identity.userId)
    if (!user) throw new NotFoundError('User')
    return user
  })
}

export async function updateMe({ displayName }, identity) {
  if (!identity?.userId) throw new ForbiddenError()
  return withStaffContext(async (client) => {
    const updated = await userRepo.updateProfile(client, identity.userId, { displayName })
    if (!updated) throw new NotFoundError('User')
    return updated
  })
}

export async function revokeUser({ id }, identity) {
  if (!identity?.userId) throw new ForbiddenError()
  if (id === identity.userId) throw new ForbiddenError('Cannot revoke yourself')

  return withStaffContext(async (client) => {
    const target = await userRepo.findAnywhereById(client, id)
    if (!target) throw new NotFoundError('User')

    if (!isStaff(identity) && (target.app_id !== identity.appId || target.tenant_id !== identity.tenantId)) {
      throw new ForbiddenError('Cannot revoke a user outside your tenant')
    }
    const ok = await userRepo.softDelete(client, id)
    if (!ok) throw new NotFoundError('User')
  })
}
