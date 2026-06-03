import crypto from 'node:crypto'
import { env } from './env.js'

// The WebSocket handshake can't go through appGuard (browsers can't set an
// Authorization header on a WS connection), so the gateway validates the token
// itself from the query string. When PLATFORM_JWT_SECRET is configured we
// verify the HS256 signature; otherwise we fall back to decode-only, matching
// appGuard's behaviour (which trusts the upstream gateway).
function b64urlJson(part) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
}

export function verifyToken(token) {
  if (!token) throw new Error('missing token')
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('invalid token format')
  const [headerB64, payloadB64, signatureB64] = parts
  const header = b64urlJson(headerB64)
  const payload = b64urlJson(payloadB64)

  const secret = env.PLATFORM_JWT_SECRET
  if (secret && header.alg === 'HS256') {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url')
    const a = Buffer.from(signatureB64)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new Error('invalid signature')
    }
  }

  if (!payload.sub) throw new Error('token missing sub')
  if (!payload.app_id) throw new Error('token missing app_id')
  if (!payload.tenant_id) throw new Error('token missing tenant_id')
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new Error('token expired')

  return {
    userId: payload.sub,
    appId: payload.app_id,
    tenantId: payload.tenant_id,
    subTenantId: payload.sub_tenant_id ?? null,
    role: payload.role,
    email: payload.email,
  }
}
