import bcrypt from 'bcrypt'
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import { env } from '../lib/env.js'
import { redis, publish } from '../lib/redis.js'
import { pool, withTenantTransaction, setTenantContext } from '../lib/db.js'
import * as userRepo from '../repositories/user.repository.js'
import * as resetRepo from '../repositories/password-reset.repository.js'
import * as activationRepo from '../repositories/activation-token.repository.js'
import { AppError, ConflictError, NotFoundError, UnauthorizedError } from '../utils/errors.js'

const REFRESH_TTL = env.PLATFORM_JWT_REFRESH_DAYS * 24 * 60 * 60

function redisKey(appId, tenantId, userId, refreshToken) {
  return `${appId}:${tenantId}:refresh:${userId}:${refreshToken}`
}

function signAccess(user) {
  return jwt.sign(
    {
      sub:          user.id,
      app_id:       user.app_id,
      tenant_id:    user.tenant_id,
      sub_tenant_id: user.sub_tenant_id ?? undefined,
      role:         user.role,
      email:        user.email,
    },
    env.PLATFORM_JWT_SECRET,
    { expiresIn: '15m' },
  )
}

export async function register({ appId, tenantId, subTenantId, email, password, role = 'user' }) {
  return withTenantTransaction(pool, appId, tenantId, subTenantId, async (client) => {
    const existing = await userRepo.findByEmail(client, appId, tenantId, email)
    if (existing) throw new ConflictError('Email already registered')
    const passwordHash = await bcrypt.hash(password, 12)
    const id = uuidv4()
    const user = await userRepo.createUser(client, { id, appId, tenantId, subTenantId: subTenantId ?? null, email, passwordHash, role })
    await publish({ type: 'user.registered', payload: { userId: id, email, role, appId, tenantId, subTenantId: subTenantId ?? null } })
    return { id: user.id, email: user.email, role: user.role }
  })
}

async function resolveUserTenant(client, email) {
  // Staff-access bypass: look across every tenant to find a user by email.
  // Only used when the caller didn't supply appId/tenantId.
  // Returns { appId, tenantId } or null if zero / ambiguous.
  await client.query(`SELECT set_config('app.app_id',       '__lookup__',                           true)`)
  await client.query(`SELECT set_config('app.tenant_id',    '00000000-0000-0000-0000-000000000000', true)`)
  await client.query(`SELECT set_config('app.staff_access', 'true',                                 true)`)
  const { rows } = await client.query(
    `SELECT app_id, tenant_id FROM platform_auth.users WHERE email = $1 AND revoked_at IS NULL`,
    [email],
  )
  if (rows.length !== 1) return null
  return { appId: rows[0].app_id, tenantId: rows[0].tenant_id }
}

export async function login({ appId, tenantId, email, password }) {
  const client = await pool.connect()
  let committed = false
  try {
    await client.query('BEGIN')

    if (!appId || !tenantId) {
      const resolved = await resolveUserTenant(client, email)
      if (!resolved) {
        await client.query('ROLLBACK')
        committed = true            // prevent double-rollback in the catch block
        throw new UnauthorizedError('Invalid credentials')
      }
      appId    = resolved.appId
      tenantId = resolved.tenantId
    }

    await setTenantContext(client, appId, tenantId, null)
    const user = await userRepo.findByEmail(client, appId, tenantId, email)
    if (!user) throw new UnauthorizedError('Invalid credentials')
    if (user.locked_until && new Date(user.locked_until) > new Date()) throw new UnauthorizedError('Account locked. Try again later.')
    // Owners pre-activación: password_hash es NULL hasta consumir el
    // magic-link. Cualquier login antes de activate → 401 con código
    // PENDING_ACTIVATION para que la UI redirija al flujo correcto.
    if (user.pending_activation || !user.password_hash) {
      throw new AppError('PENDING_ACTIVATION', 'Cuenta pendiente de activación', 401)
    }
    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) {
      await userRepo.incrementFailedAttempts(client, user.id)
      await client.query('COMMIT')
      committed = true
      throw new UnauthorizedError('Invalid credentials')
    }
    await userRepo.resetFailedAttempts(client, user.id)
    await userRepo.touchLastLogin(client, user.id)
    await client.query('COMMIT')
    committed = true
    const accessToken = signAccess(user)
    const refreshToken = uuidv4()
    await redis.setex(redisKey(appId, tenantId, user.id, refreshToken), REFRESH_TTL, '1')
    return { accessToken, refreshToken, userId: user.id, role: user.role }
  } catch (err) {
    if (!committed) await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

export async function refresh({ appId, tenantId, userId, refreshToken }) {
  const key = redisKey(appId, tenantId, userId, refreshToken)
  const valid = await redis.get(key)
  if (!valid) throw new UnauthorizedError('Invalid or expired refresh token')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await setTenantContext(client, appId, tenantId, null)
    const user = await userRepo.findById(client, appId, tenantId, userId)
    await client.query('COMMIT')
    if (!user) throw new UnauthorizedError('User not found')
    await redis.del(key)
    const newRefresh = uuidv4()
    await redis.setex(redisKey(appId, tenantId, userId, newRefresh), REFRESH_TTL, '1')
    return { accessToken: signAccess(user), refreshToken: newRefresh }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

export async function forgotPassword({ appId, tenantId, email }) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await setTenantContext(client, appId, tenantId, null)
    const user = await userRepo.findByEmail(client, appId, tenantId, email)
    if (!user) {
      await client.query('ROLLBACK')
      return // silent — no email enumeration
    }
    const token = uuidv4()
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1h
    await resetRepo.createReset(client, { id: token, userId: user.id, appId, tenantId, expiresAt })
    await client.query('COMMIT')
    await publish({ type: 'auth.password_reset_requested', payload: { userId: user.id, email, token, appId, tenantId } })
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

export async function resetPassword({ token, newPassword }) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const reset = await resetRepo.findValidReset(client, token)
    if (!reset) throw new UnauthorizedError('Invalid or expired reset token')
    await setTenantContext(client, reset.app_id, reset.tenant_id, null)
    const passwordHash = await bcrypt.hash(newPassword, 12)
    await userRepo.updatePassword(client, reset.user_id, passwordHash)
    await resetRepo.markResetUsed(client, token)
    await client.query('COMMIT')
    // Invalidate all refresh tokens for this user
    const pattern = `${reset.app_id}:${reset.tenant_id}:refresh:${reset.user_id}:*`
    const keys = await redis.keys(pattern)
    if (keys.length) await redis.del(...keys)
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

// ── Owner bootstrap (Fase A — magic-link) ────────────────────────────────
//
// El staff llama a /v1/tenants/bootstrap (en tenant-config), que a su vez
// llama a /internal/auth/owners. Esa ruta interna invoca esta función:
// crea un usuario role=owner con password_hash=NULL y pending_activation=true,
// emite un activation_token (sha256 del plano) y devuelve el plano para que
// notifications lo incluya en el email.

const ACTIVATION_TTL_DAYS = 7

function hashToken(plain) {
  return crypto.createHash('sha256').update(plain, 'utf8').digest('hex')
}

function generatePlainToken() {
  // 32 bytes URL-safe base64 ≈ 43 chars sin padding. Suficiente entropía
  // para que un dump de BD no permita activar (sólo guardamos sha256).
  return crypto.randomBytes(32).toString('base64url')
}

async function withStaffBypassTransaction(fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Usamos staff_access para que las políticas RLS dejen leer/insertar
    // sin un app/tenant context concreto (los tenemos en columnas, no en
    // current_setting). Igual patrón que resolveUserTenant de login.
    await client.query(`SELECT set_config('app.app_id',       '__internal__',                         true)`)
    await client.query(`SELECT set_config('app.tenant_id',    '00000000-0000-0000-0000-000000000000', true)`)
    await client.query(`SELECT set_config('app.staff_access', 'true',                                 true)`)
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

export async function createOwnerWithActivation({ appId, tenantId, email, displayName, ttlDays = ACTIVATION_TTL_DAYS }) {
  const plainToken = generatePlainToken()
  const tokenHash  = hashToken(plainToken)
  const expiresAt  = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000)

  const result = await withStaffBypassTransaction(async (client) => {
    const existing = await userRepo.findByEmail(client, appId, tenantId, email)
    if (existing) throw new ConflictError('Email already registered for this tenant')
    const userId = uuidv4()
    await userRepo.createUser(client, {
      id: userId, appId, tenantId, subTenantId: null,
      email, passwordHash: null, role: 'owner', displayName,
      pendingActivation: true,
    })
    const token = await activationRepo.create(client, {
      id: uuidv4(), userId, appId, tenantId, tokenHash, expiresAt,
    })
    return { userId, tokenId: token.id }
  })

  return { userId: result.userId, plainToken, expiresAt }
}

// Reenvío de magic-link: invalida los tokens activos del owner y emite
// uno nuevo. Devuelve el nuevo plano para que el caller lo mande por email.
export async function reissueActivationForOwner({ userId, ttlDays = ACTIVATION_TTL_DAYS }) {
  const plainToken = generatePlainToken()
  const tokenHash  = hashToken(plainToken)
  const expiresAt  = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000)

  const result = await withStaffBypassTransaction(async (client) => {
    const user = await userRepo.findAnywhereById(client, userId)
    if (!user) throw new NotFoundError('User')
    if (!user.pending_activation) {
      throw new AppError('ALREADY_ACTIVATED', 'El owner ya activó su cuenta', 409)
    }
    await activationRepo.revokeAllForUser(client, userId)
    await activationRepo.create(client, {
      id: uuidv4(), userId, appId: user.app_id, tenantId: user.tenant_id, tokenHash, expiresAt,
    })
    return { user }
  })

  return {
    userId,
    appId:    result.user.app_id,
    tenantId: result.user.tenant_id,
    email:    result.user.email,
    displayName: result.user.display_name,
    plainToken,
    expiresAt,
  }
}

// Estado público del owner — lo consume tenant-config para componer el
// status de bootstrap (paso "password" listo o no).
export async function getOwnerState({ tenantId }) {
  return withStaffBypassTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, email, display_name, password_hash IS NOT NULL AS password_set,
              pending_activation, owner_activated_at, app_id, tenant_id, created_at
       FROM platform_auth.users
       WHERE tenant_id = $1 AND role = 'owner' AND revoked_at IS NULL
       ORDER BY created_at ASC LIMIT 1`,
      [tenantId],
    )
    return rows[0] ?? null
  })
}

// Cuenta de admins (excluyendo al owner) — paso "admins" del checklist.
export async function countAdmins({ tenantId }) {
  return withStaffBypassTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS count FROM platform_auth.users
       WHERE tenant_id = $1 AND role = 'admin' AND revoked_at IS NULL`,
      [tenantId],
    )
    return rows[0]?.count ?? 0
  })
}

export async function activate({ token, password }) {
  if (!token)    throw new UnauthorizedError('Invalid activation token')
  if (!password) throw new AppError('VALIDATION_ERROR', 'password is required', 422)
  if (typeof password !== 'string' || password.length < 8) {
    throw new AppError('VALIDATION_ERROR', 'password must be at least 8 characters', 422)
  }

  const tokenHash = hashToken(token)
  const result = await withStaffBypassTransaction(async (client) => {
    // Distinguimos "no existe" de "consumido / expirado" para devolver
    // mensajes concretos. El token plano es secreto, así que filtrar por
    // existencia no expone información útil.
    const any = await activationRepo.findAnyByHash(client, tokenHash)
    if (!any) throw new UnauthorizedError('Invalid activation token')
    if (any.consumed_at) throw new AppError('TOKEN_USED', 'This activation link has already been used', 410)
    if (new Date(any.expires_at) <= new Date()) {
      throw new AppError('TOKEN_EXPIRED', 'This activation link has expired', 410)
    }
    const user = await userRepo.findAnywhereById(client, any.user_id)
    if (!user || user.revoked_at) throw new UnauthorizedError('User not found')
    const passwordHash = await bcrypt.hash(password, 12)
    await userRepo.markActivated(client, user.id, passwordHash)
    await activationRepo.markConsumed(client, any.id)
    return { user }
  })

  const fullUser = {
    id:            result.user.id,
    app_id:        result.user.app_id,
    tenant_id:     result.user.tenant_id,
    sub_tenant_id: result.user.sub_tenant_id ?? null,
    email:         result.user.email,
    role:          result.user.role,
  }
  const accessToken  = signAccess(fullUser)
  const refreshToken = uuidv4()
  await redis.setex(redisKey(fullUser.app_id, fullUser.tenant_id, fullUser.id, refreshToken), REFRESH_TTL, '1')
  await publish({
    type: 'tenant.activated',
    payload: {
      tenantId: fullUser.tenant_id,
      appId:    fullUser.app_id,
      ownerUserId: fullUser.id,
      ownerEmail:  fullUser.email,
    },
  })
  return {
    accessToken, refreshToken,
    userId:     fullUser.id,
    role:       fullUser.role,
    appId:      fullUser.app_id,
    tenantId:   fullUser.tenant_id,
  }
}

export function validateToken(token) {
  try {
    const payload = jwt.verify(token, env.PLATFORM_JWT_SECRET)
    return {
      userId:     payload.sub,
      appId:      payload.app_id,
      tenantId:   payload.tenant_id,
      subTenantId: payload.sub_tenant_id ?? null,
      role:       payload.role,
      email:      payload.email,
    }
  } catch {
    throw new UnauthorizedError('Invalid or expired token')
  }
}
