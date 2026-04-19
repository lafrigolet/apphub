import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import { env } from '../lib/env.js'
import { redis, publish } from '../lib/redis.js'
import { withTenantTransaction, setTenantContext, pool } from '../lib/db.js'
import * as userRepo from '../repositories/user.repository.js'
import * as resetRepo from '../repositories/password-reset.repository.js'
import { ConflictError, UnauthorizedError, NotFoundError } from '../utils/errors.js'

const REFRESH_TTL = env.YOGA_JWT_REFRESH_DAYS * 24 * 60 * 60

function signAccess(user) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      email: user.email,
      tenant_id: user.tenant_id,
      sub_tenant_id: user.sub_tenant_id ?? undefined,
    },
    env.YOGA_JWT_SECRET,
    { expiresIn: '15m' },
  )
}

export async function register({ email, password, role = 'alumno' }) {
  const tenantId = env.YOGA_TENANT_ID
  const subTenantId = env.YOGA_SUB_TENANT_ID ?? null

  return withTenantTransaction(tenantId, subTenantId, async (client) => {
    const existing = await userRepo.findByEmail(client, email, tenantId)
    if (existing) throw new ConflictError('Email already registered')

    const passwordHash = await bcrypt.hash(password, 12)
    const id = uuidv4()
    const user = await userRepo.createUser(client, { id, email, passwordHash, role, tenantId, subTenantId })

    await publish({ type: 'user.registered', payload: { userId: id, email, role, tenantId, subTenantId } })

    return { id: user.id, email: user.email, role: user.role }
  })
}

export async function login({ email, password }) {
  const tenantId = env.YOGA_TENANT_ID
  const subTenantId = env.YOGA_SUB_TENANT_ID ?? null

  const client = await pool.connect()
  try {
    await setTenantContext(client, tenantId, subTenantId)
    const user = await userRepo.findByEmail(client, email, tenantId)
    if (!user) throw new UnauthorizedError('Invalid credentials')

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      throw new UnauthorizedError('Account temporarily locked due to failed attempts')
    }

    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) {
      await userRepo.incrementFailedAttempts(client, user.id)
      throw new UnauthorizedError('Invalid credentials')
    }

    await userRepo.resetFailedAttempts(client, user.id)

    const accessToken = signAccess(user)
    const refreshToken = uuidv4()
    await redis.setex(`yoga:${tenantId}:refresh:${user.id}:${refreshToken}`, REFRESH_TTL, user.id)

    return { accessToken, refreshToken, user: { id: user.id, email: user.email, role: user.role } }
  } finally {
    client.release()
  }
}

export async function refresh({ refreshToken, userId }) {
  const tenantId = env.YOGA_TENANT_ID

  const stored = await redis.get(`yoga:${tenantId}:refresh:${userId}:${refreshToken}`)
  if (!stored) throw new UnauthorizedError('Invalid or expired refresh token')

  const subTenantId = env.YOGA_SUB_TENANT_ID ?? null
  const client = await pool.connect()
  try {
    await setTenantContext(client, tenantId, subTenantId)
    const user = await userRepo.findById(client, userId, tenantId)
    if (!user) throw new UnauthorizedError('User not found')

    await redis.del(`yoga:${tenantId}:refresh:${userId}:${refreshToken}`)
    const newRefreshToken = uuidv4()
    await redis.setex(`yoga:${tenantId}:refresh:${userId}:${newRefreshToken}`, REFRESH_TTL, userId)

    return { accessToken: signAccess(user), refreshToken: newRefreshToken }
  } finally {
    client.release()
  }
}

export async function forgotPassword({ email }) {
  const tenantId = env.YOGA_TENANT_ID
  const subTenantId = env.YOGA_SUB_TENANT_ID ?? null

  const client = await pool.connect()
  try {
    await setTenantContext(client, tenantId, subTenantId)
    const user = await userRepo.findByEmail(client, email, tenantId)
    if (!user) return // Silent — do not reveal whether email exists

    const token = uuidv4()
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1 hour
    await resetRepo.createReset(client, { token, userId: user.id, expiresAt, tenantId, subTenantId })

    await publish({ type: 'password.reset.requested', payload: { userId: user.id, email, token, tenantId, subTenantId } })
  } finally {
    client.release()
  }
}

export async function resetPassword({ token, newPassword }) {
  const tenantId = env.YOGA_TENANT_ID
  const subTenantId = env.YOGA_SUB_TENANT_ID ?? null

  return withTenantTransaction(tenantId, subTenantId, async (client) => {
    const reset = await resetRepo.findValidReset(client, token)
    if (!reset) throw new NotFoundError('Password reset token')

    const passwordHash = await bcrypt.hash(newPassword, 12)
    await userRepo.updatePassword(client, reset.user_id, passwordHash)
    await resetRepo.markResetUsed(client, token)

    const keys = await redis.keys(`yoga:${tenantId}:refresh:${reset.user_id}:*`)
    if (keys.length) await redis.del(...keys)
  })
}

export async function validateToken(token) {
  try {
    const payload = jwt.verify(token, env.YOGA_JWT_SECRET)
    return {
      valid: true,
      userId: payload.sub,
      role: payload.role,
      email: payload.email,
      tenantId: payload.tenant_id,
      subTenantId: payload.sub_tenant_id ?? null,
    }
  } catch {
    return { valid: false }
  }
}
