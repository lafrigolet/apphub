import { describe, it, expect, vi } from 'vitest'
import crypto from 'node:crypto'

vi.mock('../lib/env.js', () => ({
  env: {
    NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z',
    PLATFORM_JWT_SECRET: 'platform_dev_secret_at_least_32_characters_long_ok',
  },
}))

const SECRET = 'platform_dev_secret_at_least_32_characters_long_ok'

import { verifyToken } from '../lib/jwt.js'

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url')
}
function sign(header, payload, secret = SECRET) {
  const h = b64url(header)
  const p = b64url(payload)
  const sig = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')
  return `${h}.${p}.${sig}`
}

const claims = {
  sub: 'u-1', app_id: 'platform', tenant_id: 't-1', sub_tenant_id: null, role: 'user', email: 'u@x.com',
}

describe('verifyToken', () => {
  it('verifies a valid HS256 token and maps claims to identity', () => {
    const id = verifyToken(sign({ alg: 'HS256', typ: 'JWT' }, claims))
    expect(id).toEqual({
      userId: 'u-1', appId: 'platform', tenantId: 't-1', subTenantId: null, role: 'user', email: 'u@x.com',
    })
  })

  it('rejects a tampered signature', () => {
    expect(() => verifyToken(sign({ alg: 'HS256' }, claims, 'wrong-secret-but-32-characters-long!!'))).toThrow(/signature/)
  })

  it('rejects a missing / malformed token', () => {
    expect(() => verifyToken(null)).toThrow()
    expect(() => verifyToken('a.b')).toThrow()
  })

  it('rejects an expired token', () => {
    const expired = sign({ alg: 'HS256' }, { ...claims, exp: 1 })
    expect(() => verifyToken(expired)).toThrow(/expired/)
  })

  it('requires sub / app_id / tenant_id', () => {
    expect(() => verifyToken(sign({ alg: 'HS256' }, { app_id: 'p', tenant_id: 't' }))).toThrow(/sub/)
    expect(() => verifyToken(sign({ alg: 'HS256' }, { sub: 'u', tenant_id: 't' }))).toThrow(/app_id/)
    expect(() => verifyToken(sign({ alg: 'HS256' }, { sub: 'u', app_id: 'p' }))).toThrow(/tenant_id/)
  })
})
