import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import { env } from '../lib/env.js'
import { redis, publish } from '../lib/redis.js'
import { pool, withTenantTransaction, setTenantContext } from '../lib/db.js'
import * as userRepo from '../repositories/user.repository.js'
import * as resetRepo from '../repositories/password-reset.repository.js'
import { ConflictError, UnauthorizedError } from '../utils/errors.js'

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

export async function login({ appId, tenantId, email, password }) {
  const client = await pool.connect()
  try {
    await setTenantContext(client, appId, tenantId, null)
    const user = await userRepo.findByEmail(client, appId, tenantId, email)
    if (!user) throw new UnauthorizedError('Invalid credentials')
    if (user.locked_until && new Date(user.locked_until) > new Date()) throw new UnauthorizedError('Account locked. Try again later.')
    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) {
      await userRepo.incrementFailedAttempts(client, user.id)
      throw new UnauthorizedError('Invalid credentials')
    }
    await userRepo.resetFailedAttempts(client, user.id)
    const accessToken = signAccess(user)
    const refreshToken = uuidv4()
    await redis.setex(redisKey(appId, tenantId, user.id, refreshToken), REFRESH_TTL, '1')
    return { accessToken, refreshToken, userId: user.id, role: user.role }
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
    await setTenantContext(client, appId, tenantId, null)
    const user = await userRepo.findById(client, appId, tenantId, userId)
    if (!user) throw new UnauthorizedError('User not found')
    await redis.del(key)
    const newRefresh = uuidv4()
    await redis.setex(redisKey(appId, tenantId, userId, newRefresh), REFRESH_TTL, '1')
    return { accessToken: signAccess(user), refreshToken: newRefresh }
  } finally {
    client.release()
  }
}

export async function forgotPassword({ appId, tenantId, email }) {
  const client = await pool.connect()
  try {
    await setTenantContext(client, appId, tenantId, null)
    const user = await userRepo.findByEmail(client, appId, tenantId, email)
    if (!user) return // silent — no email enumeration
    const token = uuidv4()
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1h
    await resetRepo.createReset(client, { id: token, userId: user.id, appId, tenantId, expiresAt })
    await publish({ type: 'auth.password_reset_requested', payload: { userId: user.id, email, token, appId, tenantId } })
  } finally {
    client.release()
  }
}

export async function resetPassword({ token, newPassword }) {
  const client = await pool.connect()
  try {
    const reset = await resetRepo.findValidReset(client, token)
    if (!reset) throw new UnauthorizedError('Invalid or expired reset token')
    const passwordHash = await bcrypt.hash(newPassword, 12)
    await client.query('BEGIN')
    await userRepo.updatePassword(client, reset.user_id, passwordHash)
    await resetRepo.markResetUsed(client, token)
    // Invalidate all refresh tokens for this user
    const pattern = `${reset.app_id}:${reset.tenant_id}:refresh:${reset.user_id}:*`
    const keys = await redis.keys(pattern)
    if (keys.length) await redis.del(...keys)
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
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
