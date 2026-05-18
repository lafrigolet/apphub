import crypto from 'node:crypto'
import { v4 as uuidv4 } from 'uuid'
import { pool } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as userRepo from '../repositories/user.repository.js'
import * as resetRepo from '../repositories/password-reset.repository.js'
import { ForbiddenError, NotFoundError, AppError } from '../utils/errors.js'
import { register as authRegister, forgotPassword as authForgotPassword } from './auth.service.js'

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

export async function listUsers({ appId, tenantId, role, pending }, identity) {
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
    return withStaffContext((client) => userRepo.list(client, { appId, tenantId, role, pending }))
  }
  const runner = isStaff(identity) ? withStaffContext : (fn) => withTenantContext(appId, tenantId, fn)
  return runner((client) => userRepo.list(client, { appId, tenantId, role, pending }))
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

// Admin/staff lectura puntual. El scope replica el de `listUsers`: staff
// ve cualquier user (vía staff_access); resto solo dentro de su (app,tenant).
export async function getById(id, identity) {
  if (!identity?.userId) throw new ForbiddenError()
  return withStaffContext(async (client) => {
    const user = await userRepo.findAnywhereById(client, id)
    if (!user) throw new NotFoundError('User')
    if (!isStaff(identity) && (user.app_id !== identity.appId || user.tenant_id !== identity.tenantId)) {
      throw new ForbiddenError('Cannot read a user outside your tenant')
    }
    return user
  })
}

// Admin/staff edita campos seguros de otro user (display_name por ahora;
// futuras columnas — locale — entran aquí también). El propio user usa
// `/me`; este endpoint es para overrides desde la consola.
export async function updateUser(id, body, identity) {
  if (!identity?.userId) throw new ForbiddenError()
  return withStaffContext(async (client) => {
    const target = await userRepo.findAnywhereById(client, id)
    if (!target) throw new NotFoundError('User')
    if (!isStaff(identity) && (target.app_id !== identity.appId || target.tenant_id !== identity.tenantId)) {
      throw new ForbiddenError('Cannot update a user outside your tenant')
    }
    const updated = await userRepo.updateProfile(client, id, body)
    if (!updated) throw new NotFoundError('User')
    return updated
  })
}

// Password aleatoria que sirve sólo de placeholder hasta que el invitado
// consuma el magic-link y fije la suya propia. Nunca se muestra ni se
// loguea — sólo existe para que `register()` cree un password_hash válido.
function randomTempPassword() {
  return crypto.randomBytes(24).toString('base64url').slice(0, 32) + 'A1!'
}

// Invitación atómica: register + emit reset event en una sola llamada.
// Encapsula el flujo de 2 pasos que hoy duplican console y aikikan-portal
// (ver apps/console/console-portal/src/views/staff/TenantDetail.jsx:206).
// El password queda como bcrypt random; el invitado fija la suya vía el
// magic-link que dispara `auth.password_reset_requested`.
export async function inviteUser({ appId, tenantId, email, role, displayName }, identity) {
  if (!identity?.userId) throw new ForbiddenError()
  if (!isStaff(identity) && (appId !== identity.appId || tenantId !== identity.tenantId)) {
    throw new ForbiddenError('Cannot invite users outside your tenant')
  }
  const { id } = await authRegister({
    appId, tenantId, subTenantId: null,
    email,
    password: randomTempPassword(),
    role: role ?? 'user',
  })
  // Si `displayName` viene poblado, lo aplicamos antes del magic-link
  // (mejor UX en el email de invitación). Usa el helper de profile que
  // sólo toca display_name — nada peligroso.
  if (displayName) {
    await withStaffContext((client) => userRepo.updateProfile(client, id, { displayName }))
  }
  // Dispara el evento de reset que platform/notifications consume para
  // mandar el email con el magic-link. NO devolvemos token ni tokens
  // de sesión — la activación va por correo.
  await authForgotPassword({ appId, tenantId, email })
  return { userId: id }
}

// Cualquier admin del tenant (owner/admin/staff/super_admin) aprueba la
// solicitud. Pasos:
//   1) flip pending_approval=FALSE
//   2) crear password_reset token (mismo store que forgotPassword)
//   3) emitir `auth.signup.approved` con el token plano → notifications
//      manda email con magic-link "tu cuenta ha sido aprobada, fija tu
//      contraseña aquí"
// Si el user llegó vía OAuth y nunca usará password, el link queda sin
// consumir pero puede volver a entrar con Google/Facebook igual.
export async function approveUser(id, identity) {
  if (!identity?.userId) throw new ForbiddenError()
  return withStaffContext(async (client) => {
    const target = await userRepo.findAnywhereById(client, id)
    if (!target) throw new NotFoundError('User')
    if (!isStaff(identity) && (target.app_id !== identity.appId || target.tenant_id !== identity.tenantId)) {
      throw new ForbiddenError('Cannot approve a user outside your tenant')
    }
    if (!target.pending_approval) {
      throw new AppError('NOT_PENDING', 'El usuario no está pendiente de aprobación', 409)
    }
    const approved = await userRepo.approve(client, id)
    if (!approved) throw new NotFoundError('User')

    // Crea el token de password-reset que el user usará como magic-link
    // de bienvenida. Mismo store que forgotPassword (1h TTL).
    const token = uuidv4()
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000)
    await resetRepo.createReset(client, {
      id: token, userId: approved.id, appId: approved.app_id, tenantId: approved.tenant_id, expiresAt,
    })
    await publish({
      type: 'auth.signup.approved',
      payload: {
        userId: approved.id, email: approved.email, displayName: approved.display_name,
        appId: approved.app_id, tenantId: approved.tenant_id, token,
      },
    })
    return approved
  })
}

// Rechazo: hard-delete del row. El email queda libre y la persona puede
// re-solicitar. Cualquier oauth_connection / password_reset cae por
// cascada de FK. Emite `auth.signup.rejected` para que aikikan-server
// limpie el row de app_aikikan.members si lo tuviera, y notifications
// envíe email "lo sentimos".
export async function rejectUser(id, identity, { reason } = {}) {
  if (!identity?.userId) throw new ForbiddenError()
  return withStaffContext(async (client) => {
    const target = await userRepo.findAnywhereById(client, id)
    if (!target) throw new NotFoundError('User')
    if (!isStaff(identity) && (target.app_id !== identity.appId || target.tenant_id !== identity.tenantId)) {
      throw new ForbiddenError('Cannot reject a user outside your tenant')
    }
    if (!target.pending_approval) {
      throw new AppError('NOT_PENDING', 'El usuario no está pendiente de aprobación (use revoke)', 409)
    }
    const ok = await userRepo.hardDelete(client, id)
    if (!ok) throw new NotFoundError('User')
    await publish({
      type: 'auth.signup.rejected',
      payload: {
        userId: target.id, email: target.email, displayName: target.display_name,
        appId: target.app_id, tenantId: target.tenant_id, reason: reason ?? null,
      },
    })
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
