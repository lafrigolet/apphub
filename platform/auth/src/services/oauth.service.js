import { OAuth2Client } from 'google-auth-library'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import { env } from '../lib/env.js'
import { redis } from '../lib/redis.js'
import { pool, withTransaction } from '../lib/db.js'
import * as oauthRepo from '../repositories/oauth.repository.js'
import * as providersRepo from '../repositories/oauth-providers.repository.js'
import { publish } from '../lib/redis.js'
import { AppError } from '../utils/errors.js'
import { tenantRequiresApproval, resolveAppTenant } from './auth.service.js'

const REFRESH_TTL = env.PLATFORM_JWT_REFRESH_DAYS * 24 * 60 * 60

// Resolve a provider's live config: prefer the DB row (set via the admin
// UI), fall back to env vars for back-compat with pre-migration deployments.
// Returns { clientId, clientSecret, enabled } or null if neither source has it.
async function resolveProviderConfig(provider) {
  const client = await pool.connect()
  let row
  try {
    row = await providersRepo.getProviderConfig(client, provider)
  } finally {
    client.release()
  }
  if (row && row.clientId) return row
  if (provider === 'google' && env.GOOGLE_CLIENT_ID) {
    return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: null, enabled: true }
  }
  if (provider === 'facebook' && env.FACEBOOK_APP_ID && env.FACEBOOK_APP_SECRET) {
    return { clientId: env.FACEBOOK_APP_ID, clientSecret: env.FACEBOOK_APP_SECRET, enabled: true }
  }
  return null
}

function signAccess(user) {
  // Colapso a un tenant por defecto: sin sub_tenant_id en el JWT (ver
  // auth.service.js#signAccess).
  return jwt.sign(
    {
      sub:           user.id,
      app_id:        user.app_id,
      tenant_id:     user.tenant_id,
      role:          user.role,
      email:         user.email,
    },
    env.PLATFORM_JWT_SECRET,
    { expiresIn: '15m' },
  )
}

function redisKey(appId, tenantId, userId, refreshToken) {
  return `${appId}:${tenantId}:refresh:${userId}:${refreshToken}`
}

async function issueTokens(user) {
  const accessToken = signAccess(user)
  const refreshToken = uuidv4()
  await redis.setex(redisKey(user.app_id, user.tenant_id, user.id, refreshToken), REFRESH_TTL, '1')
  return { accessToken, refreshToken, userId: user.id, role: user.role }
}

async function resolveOAuthUser(client, { appId, tenantId, provider, providerUid, email, name, avatarUrl }) {
  const existing = await oauthRepo.findConnectionByProvider(client, provider, providerUid)
  if (existing) {
    await oauthRepo.upsertConnection(client, { userId: existing.user_id, provider, providerUid, email, name, avatarUrl })
    return { id: existing.user_id, app_id: existing.app_id, tenant_id: existing.tenant_id, sub_tenant_id: existing.sub_tenant_id, email: existing.user_email, role: existing.role }
  }

  // Link to an existing email account if present
  const byEmail = email ? await oauthRepo.findByEmailForOAuth(client, appId, tenantId, email) : null
  if (byEmail) {
    await oauthRepo.upsertConnection(client, { userId: byEmail.id, provider, providerUid, email, name, avatarUrl })
    return byEmail
  }

  // Create new user — si el tenant requiere aprobación, queda pending.
  // El caller (oauthLogin) ve `pending_approval=true` y devuelve 403
  // PENDING_APPROVAL en lugar de tokens, similar al gate del password
  // login. Emitimos `auth.signup.requested` para notificar igual que
  // el flow de password-self-register.
  const pendingApproval = await tenantRequiresApproval(appId, tenantId)
  const id = uuidv4()
  const user = await oauthRepo.createUserWithOAuth(client, {
    id, appId, tenantId, subTenantId: null,
    email, role: 'user', provider, providerUid, name, avatarUrl,
    pendingApproval,
  })
  if (pendingApproval) {
    await publish({
      type: 'auth.signup.requested',
      payload: { userId: id, email, displayName: name ?? null, notes: `Vía ${provider}`, appId, tenantId },
    })
  } else {
    await publish({ type: 'user.registered', payload: { userId: id, email, role: 'user', appId, tenantId, subTenantId: null, provider } })
  }
  return user
}

export async function loginWithGoogle({ appId, tenantId, credential }) {
  const cfg = await resolveProviderConfig('google')
  if (!cfg || !cfg.enabled) throw new AppError('OAUTH_NOT_CONFIGURED', 'Google OAuth is not configured', 501)
  // Colapso 1 app → 1 tenant: derivamos el tenant del app si no llega.
  if (appId && !tenantId) tenantId = await resolveAppTenant(appId)

  const googleClient = new OAuth2Client(cfg.clientId)
  let ticket
  try {
    ticket = await googleClient.verifyIdToken({ idToken: credential, audience: cfg.clientId })
  } catch {
    throw new AppError('INVALID_OAUTH_TOKEN', 'Invalid Google credential', 401)
  }

  const payload = ticket.getPayload()
  const providerUid = payload.sub
  const email = payload.email
  const name = payload.name
  const avatarUrl = payload.picture

  return withTransaction(pool, async (client) => {
    const user = await resolveOAuthUser(client, { appId, tenantId, provider: 'google', providerUid, email, name, avatarUrl })
    if (user.pending_approval) throw new AppError('PENDING_APPROVAL', 'Tu solicitud está pendiente de aprobación', 403)
    return issueTokens(user)
  })
}

export async function loginWithFacebook({ appId, tenantId, accessToken }) {
  const cfg = await resolveProviderConfig('facebook')
  if (!cfg || !cfg.enabled || !cfg.clientId || !cfg.clientSecret) {
    throw new AppError('OAUTH_NOT_CONFIGURED', 'Facebook OAuth is not configured', 501)
  }
  // Colapso 1 app → 1 tenant: derivamos el tenant del app si no llega.
  if (appId && !tenantId) tenantId = await resolveAppTenant(appId)

  // Verify token with Facebook and fetch user data
  let profile
  try {
    const appToken = `${cfg.clientId}|${cfg.clientSecret}`
    const verifyUrl = `https://graph.facebook.com/debug_token?input_token=${accessToken}&access_token=${appToken}`
    const verifyRes = await fetch(verifyUrl)
    const verifyData = await verifyRes.json()
    if (!verifyData.data?.is_valid) throw new Error('Token not valid')

    const profileUrl = `https://graph.facebook.com/me?fields=id,name,email,picture&access_token=${accessToken}`
    const profileRes = await fetch(profileUrl)
    profile = await profileRes.json()
    if (!profile.id) throw new Error('No user id')
  } catch {
    throw new AppError('INVALID_OAUTH_TOKEN', 'Invalid Facebook access token', 401)
  }

  const providerUid = profile.id
  const email = profile.email ?? null
  const name = profile.name ?? null
  const avatarUrl = profile.picture?.data?.url ?? null

  return withTransaction(pool, async (client) => {
    const user = await resolveOAuthUser(client, { appId, tenantId, provider: 'facebook', providerUid, email, name, avatarUrl })
    if (user.pending_approval) throw new AppError('PENDING_APPROVAL', 'Tu solicitud está pendiente de aprobación', 403)
    return issueTokens(user)
  })
}
