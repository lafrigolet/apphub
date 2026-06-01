// Repository SQL-shape tests for platform/auth.
// Each repo fn receives a `client` with a mocked `query`; we assert the SQL
// targets the right table/clauses and the params array is in the right order.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@apphub/platform-sdk/crypto', () => ({
  encryptSecret: vi.fn((v) => (v == null ? Buffer.from('') : Buffer.from(`enc:${v}`))),
  decryptSecret: vi.fn((b) => (b ? `dec:${b}` : null)),
}))

import * as activationRepo from '../repositories/activation-token.repository.js'
import * as magicLinkRepo from '../repositories/magic-link.repository.js'
import * as oauthProvidersRepo from '../repositories/oauth-providers.repository.js'
import * as oauthRepo from '../repositories/oauth.repository.js'
import * as resetRepo from '../repositories/password-reset.repository.js'
import * as userRepo from '../repositories/user.repository.js'
import { encryptSecret, decryptSecret } from '@apphub/platform-sdk/crypto'

function mockClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}
function mockClientCount(rowCount) {
  return { query: vi.fn().mockResolvedValue({ rows: [], rowCount }) }
}

beforeEach(() => vi.clearAllMocks())

// ── activation-token.repository ─────────────────────────────────────

describe('activation-token.repository', () => {
  const args = { id: 'a1', userId: 'u1', appId: 'app', tenantId: 't1', tokenHash: 'h', expiresAt: 'E' }

  it('create → INSERT INTO platform_auth.activation_tokens', async () => {
    const c = mockClient([{ id: 'a1' }])
    const r = await activationRepo.create(c, args)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_auth\.activation_tokens/)
    expect(params).toEqual(['a1', 'u1', 'app', 't1', 'h', 'E'])
    expect(r).toEqual({ id: 'a1' })
  })

  it('findValidByHash → consumed_at IS NULL AND expires_at > now()', async () => {
    const c = mockClient([{ id: 'a1' }])
    const r = await activationRepo.findValidByHash(c, 'h')
    expect(c.query.mock.calls[0][0]).toMatch(/consumed_at IS NULL AND expires_at > now\(\)/)
    expect(c.query.mock.calls[0][1]).toEqual(['h'])
    expect(r).toEqual({ id: 'a1' })
  })

  it('findValidByHash → null cuando no hay row', async () => {
    const c = mockClient([])
    expect(await activationRepo.findValidByHash(c, 'h')).toBeNull()
  })

  it('findAnyByHash → WHERE token_hash = $1; null si vacío', async () => {
    const c = mockClient([])
    expect(await activationRepo.findAnyByHash(c, 'h')).toBeNull()
    expect(c.query.mock.calls[0][0]).toMatch(/WHERE token_hash = \$1/)
  })

  it('findAnyByHash → row', async () => {
    const c = mockClient([{ id: 'a1' }])
    expect(await activationRepo.findAnyByHash(c, 'h')).toEqual({ id: 'a1' })
  })

  it('markConsumed → UPDATE SET consumed_at = now()', async () => {
    const c = mockClient([])
    await activationRepo.markConsumed(c, 'a1')
    expect(c.query.mock.calls[0][0]).toMatch(/SET consumed_at = now\(\)/)
    expect(c.query.mock.calls[0][1]).toEqual(['a1'])
  })

  it('revokeAllForUser → WHERE user_id = $1 AND consumed_at IS NULL', async () => {
    const c = mockClient([])
    await activationRepo.revokeAllForUser(c, 'u1')
    expect(c.query.mock.calls[0][0]).toMatch(/WHERE user_id = \$1 AND consumed_at IS NULL/)
    expect(c.query.mock.calls[0][1]).toEqual(['u1'])
  })
})

// ── magic-link.repository ───────────────────────────────────────────

describe('magic-link.repository', () => {
  const args = { id: 'm1', userId: 'u1', appId: 'app', tenantId: 't1', tokenHash: 'h', expiresAt: 'E' }

  it('create → INSERT INTO platform_auth.magic_links', async () => {
    const c = mockClient([{ id: 'm1' }])
    const r = await magicLinkRepo.create(c, args)
    expect(c.query.mock.calls[0][0]).toMatch(/INSERT INTO platform_auth\.magic_links/)
    expect(c.query.mock.calls[0][1]).toEqual(['m1', 'u1', 'app', 't1', 'h', 'E'])
    expect(r).toEqual({ id: 'm1' })
  })

  it('findValidByHash → valid clause; null', async () => {
    const c = mockClient([])
    expect(await magicLinkRepo.findValidByHash(c, 'h')).toBeNull()
    expect(c.query.mock.calls[0][0]).toMatch(/consumed_at IS NULL AND expires_at > now\(\)/)
  })

  it('findValidByHash → row', async () => {
    const c = mockClient([{ id: 'm1' }])
    expect(await magicLinkRepo.findValidByHash(c, 'h')).toEqual({ id: 'm1' })
  })

  it('findAnyByHash → row + null', async () => {
    const c = mockClient([{ id: 'm1' }])
    expect(await magicLinkRepo.findAnyByHash(c, 'h')).toEqual({ id: 'm1' })
    const c2 = mockClient([])
    expect(await magicLinkRepo.findAnyByHash(c2, 'h')).toBeNull()
  })

  it('markConsumed → SET consumed_at = now()', async () => {
    const c = mockClient([])
    await magicLinkRepo.markConsumed(c, 'm1')
    expect(c.query.mock.calls[0][0]).toMatch(/SET consumed_at = now\(\)/)
    expect(c.query.mock.calls[0][1]).toEqual(['m1'])
  })
})

// ── oauth-providers.repository ──────────────────────────────────────

describe('oauth-providers.repository', () => {
  it('listProviders → mapea google+facebook, configured según secret', async () => {
    const c = mockClient([
      { provider: 'google', client_id: 'gid', encrypted_client_secret: Buffer.from('x'), enabled: true, updated_at: 'T' },
    ])
    const r = await oauthProvidersRepo.listProviders(c)
    expect(c.query.mock.calls[0][0]).toMatch(/FROM platform_auth\.oauth_providers ORDER BY provider/)
    expect(r).toEqual([
      { provider: 'google', clientId: 'gid', configured: true, enabled: true, updatedAt: 'T' },
      { provider: 'facebook', clientId: null, configured: false, enabled: false, updatedAt: null },
    ])
  })

  it('getProviderConfig → null cuando no hay row', async () => {
    const c = mockClient([])
    expect(await oauthProvidersRepo.getProviderConfig(c, 'google')).toBeNull()
    expect(c.query.mock.calls[0][1]).toEqual(['google'])
  })

  it('getProviderConfig → desencripta secret', async () => {
    const c = mockClient([{ client_id: 'gid', encrypted_client_secret: Buffer.from('sec'), enabled: true }])
    const r = await oauthProvidersRepo.getProviderConfig(c, 'google')
    expect(decryptSecret).toHaveBeenCalled()
    expect(r).toMatchObject({ clientId: 'gid', enabled: true })
  })

  it('upsertProvider → throw provider desconocido', async () => {
    const c = mockClient([])
    await expect(oauthProvidersRepo.upsertProvider(c, { provider: 'twitter' }))
      .rejects.toThrow(/Unknown provider/)
  })

  it('upsertProvider → INSERT ... ON CONFLICT con campos nuevos', async () => {
    // getProviderConfig devuelve null (no hay row previa)
    const c = { query: vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }) }
    const next = await oauthProvidersRepo.upsertProvider(c, {
      provider: 'google', clientId: 'gid', clientSecret: 'sec', enabled: true, updatedByUserId: 'admin',
    })
    expect(next).toEqual({ clientId: 'gid', clientSecret: 'sec', enabled: true })
    expect(encryptSecret).toHaveBeenCalledWith('sec')
    const insertCall = c.query.mock.calls[1]
    expect(insertCall[0]).toMatch(/ON CONFLICT \(provider\) DO UPDATE/)
    expect(insertCall[1][0]).toBe('google')
    expect(insertCall[1][3]).toBe(true)
    expect(insertCall[1][4]).toBe('admin')
  })

  it('upsertProvider → valores definidos pero falsy (clientId/secret "", enabled false) → null/false', async () => {
    // clientId='' (definido, falsy) → '' || null = null
    // clientSecret='' (definido, falsy) → null
    // enabled=false (definido) → !!false = false
    const c = { query: vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }) }
    const next = await oauthProvidersRepo.upsertProvider(c, {
      provider: 'google', clientId: '', clientSecret: '', enabled: false,
    })
    expect(next).toEqual({ clientId: null, clientSecret: null, enabled: false })
    const insertParams = c.query.mock.calls[1][1]
    expect(insertParams[1]).toBeNull()   // client_id
    expect(insertParams[3]).toBe(false)  // enabled
  })

  it('upsertProvider → undefined preserva valores actuales', async () => {
    // primer query: getProviderConfig devuelve row existente
    const c = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ client_id: 'old', encrypted_client_secret: Buffer.from('x'), enabled: true }] })
        .mockResolvedValueOnce({ rows: [] }),
    }
    const next = await oauthProvidersRepo.upsertProvider(c, { provider: 'facebook' })
    expect(next.clientId).toBe('old')
    expect(next.enabled).toBe(true)
  })

  it('upsertProvider → updatedByUserId ausente → null', async () => {
    const c = { query: vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }) }
    await oauthProvidersRepo.upsertProvider(c, { provider: 'google', enabled: false })
    expect(c.query.mock.calls[1][1][4]).toBeNull()
  })
})

// ── oauth.repository ────────────────────────────────────────────────

describe('oauth.repository', () => {
  it('findConnectionByProvider → JOIN users; null si vacío', async () => {
    const c = mockClient([])
    expect(await oauthRepo.findConnectionByProvider(c, 'google', 'uid')).toBeNull()
    expect(c.query.mock.calls[0][0]).toMatch(/JOIN platform_auth\.users u ON u\.id = oc\.user_id/)
    expect(c.query.mock.calls[0][1]).toEqual(['google', 'uid'])
  })

  it('findConnectionByProvider → row', async () => {
    const c = mockClient([{ user_id: 'u1' }])
    expect(await oauthRepo.findConnectionByProvider(c, 'google', 'uid')).toEqual({ user_id: 'u1' })
  })

  it('findByEmailForOAuth → app_id + tenant_id + email scoping', async () => {
    const c = mockClient([{ id: 'u1' }])
    const r = await oauthRepo.findByEmailForOAuth(c, 'app', 't1', 'a@x.com')
    expect(c.query.mock.calls[0][1]).toEqual(['app', 't1', 'a@x.com'])
    expect(r).toEqual({ id: 'u1' })
    const c2 = mockClient([])
    expect(await oauthRepo.findByEmailForOAuth(c2, 'app', 't1', 'a@x.com')).toBeNull()
  })

  it('createUserWithOAuth → INSERT user + oauth_connection', async () => {
    const c = { query: vi.fn().mockResolvedValueOnce({ rows: [{ id: 'u1' }] }).mockResolvedValueOnce({ rows: [] }) }
    const r = await oauthRepo.createUserWithOAuth(c, {
      id: 'u1', appId: 'app', tenantId: 't1', subTenantId: null, email: 'a@x.com',
      role: 'user', provider: 'google', providerUid: 'g1', name: 'Ana', avatarUrl: 'http://a',
    })
    expect(c.query.mock.calls[0][0]).toMatch(/INSERT INTO platform_auth\.users/)
    expect(c.query.mock.calls[1][0]).toMatch(/INSERT INTO platform_auth\.oauth_connections/)
    expect(c.query.mock.calls[1][1]).toEqual(['u1', 'google', 'g1', 'a@x.com', 'Ana', 'http://a'])
    expect(r).toEqual({ id: 'u1' })
  })

  it('createUserWithOAuth → defaults (pendingApproval, name/avatar null)', async () => {
    const c = { query: vi.fn().mockResolvedValueOnce({ rows: [{ id: 'u1' }] }).mockResolvedValueOnce({ rows: [] }) }
    await oauthRepo.createUserWithOAuth(c, {
      id: 'u1', appId: 'app', tenantId: 't1', email: 'a@x.com', role: 'user',
      provider: 'google', providerUid: 'g1',
    })
    // sub_tenant_id null, display_name null, pending_approval false
    expect(c.query.mock.calls[0][1]).toEqual(['u1', 'app', 't1', null, 'a@x.com', 'user', null, false])
  })

  it('upsertConnection → ON CONFLICT (provider, provider_uid)', async () => {
    const c = mockClient([])
    await oauthRepo.upsertConnection(c, { userId: 'u1', provider: 'google', providerUid: 'g1', email: 'a@x.com' })
    expect(c.query.mock.calls[0][0]).toMatch(/ON CONFLICT \(provider, provider_uid\) DO UPDATE/)
    expect(c.query.mock.calls[0][1]).toEqual(['u1', 'google', 'g1', 'a@x.com', null, null])
  })
})

// ── password-reset.repository ───────────────────────────────────────

describe('password-reset.repository', () => {
  it('createReset → INSERT password_resets', async () => {
    const c = mockClient([])
    await resetRepo.createReset(c, { id: 'r1', userId: 'u1', appId: 'app', tenantId: 't1', expiresAt: 'E' })
    expect(c.query.mock.calls[0][0]).toMatch(/INSERT INTO platform_auth\.password_resets/)
    expect(c.query.mock.calls[0][1]).toEqual(['r1', 'u1', 'app', 't1', 'E'])
  })

  it('findValidReset → used_at IS NULL AND expires_at > now(); row + null', async () => {
    const c = mockClient([{ id: 'r1' }])
    expect(await resetRepo.findValidReset(c, 'r1')).toEqual({ id: 'r1' })
    expect(c.query.mock.calls[0][0]).toMatch(/used_at IS NULL AND expires_at > now\(\)/)
    const c2 = mockClient([])
    expect(await resetRepo.findValidReset(c2, 'r1')).toBeNull()
  })

  it('markResetUsed → SET used_at = now()', async () => {
    const c = mockClient([])
    await resetRepo.markResetUsed(c, 'r1')
    expect(c.query.mock.calls[0][0]).toMatch(/SET used_at = now\(\)/)
    expect(c.query.mock.calls[0][1]).toEqual(['r1'])
  })
})

// ── user.repository ─────────────────────────────────────────────────

describe('user.repository', () => {
  it('findByEmail → app_id+tenant_id+email; row + null', async () => {
    const c = mockClient([{ id: 'u1' }])
    expect(await userRepo.findByEmail(c, 'app', 't1', 'a@x.com')).toEqual({ id: 'u1' })
    expect(c.query.mock.calls[0][1]).toEqual(['app', 't1', 'a@x.com'])
    const c2 = mockClient([])
    expect(await userRepo.findByEmail(c2, 'app', 't1', 'a@x.com')).toBeNull()
  })

  it('findById → scoped por app+tenant+id', async () => {
    const c = mockClient([{ id: 'u1' }])
    expect(await userRepo.findById(c, 'app', 't1', 'u1')).toEqual({ id: 'u1' })
    expect(c.query.mock.calls[0][1]).toEqual(['app', 't1', 'u1'])
    const c2 = mockClient([])
    expect(await userRepo.findById(c2, 'app', 't1', 'u1')).toBeNull()
  })

  it('createUser → INSERT con 10 params; defaults', async () => {
    const c = mockClient([{ id: 'u1' }])
    await userRepo.createUser(c, {
      id: 'u1', appId: 'app', tenantId: 't1', email: 'a@x.com', role: 'user',
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_auth\.users/)
    // subTenantId null, passwordHash null, displayName null, pendingActivation false, pendingApproval false
    expect(params).toEqual(['u1', 'app', 't1', null, 'a@x.com', null, 'user', null, false, false])
  })

  it('createUser → con todos los campos', async () => {
    const c = mockClient([{ id: 'u1' }])
    await userRepo.createUser(c, {
      id: 'u1', appId: 'app', tenantId: 't1', subTenantId: 's1', email: 'a@x.com',
      passwordHash: 'h', role: 'owner', displayName: 'Ana', pendingActivation: true, pendingApproval: true,
    })
    expect(c.query.mock.calls[0][1]).toEqual(['u1', 'app', 't1', 's1', 'a@x.com', 'h', 'owner', 'Ana', true, true])
  })

  it('markActivated → COALESCE(owner_activated_at, now()); row + null', async () => {
    const c = mockClient([{ id: 'u1' }])
    expect(await userRepo.markActivated(c, 'u1', 'h')).toEqual({ id: 'u1' })
    expect(c.query.mock.calls[0][0]).toMatch(/owner_activated_at = COALESCE\(owner_activated_at, now\(\)\)/)
    expect(c.query.mock.calls[0][1]).toEqual(['u1', 'h'])
    const c2 = mockClient([])
    expect(await userRepo.markActivated(c2, 'u1', 'h')).toBeNull()
  })

  it('incrementFailedAttempts → lock tras 5 intentos', async () => {
    const c = mockClient([])
    await userRepo.incrementFailedAttempts(c, 'u1')
    expect(c.query.mock.calls[0][0]).toMatch(/failed_login_attempts = failed_login_attempts \+ 1/)
    expect(c.query.mock.calls[0][1]).toEqual(['u1'])
  })

  it('resetFailedAttempts → SET 0 + locked_until NULL', async () => {
    const c = mockClient([])
    await userRepo.resetFailedAttempts(c, 'u1')
    expect(c.query.mock.calls[0][0]).toMatch(/failed_login_attempts = 0, locked_until = NULL/)
  })

  it('updatePassword → SET password_hash', async () => {
    const c = mockClient([])
    await userRepo.updatePassword(c, 'u1', 'h')
    expect(c.query.mock.calls[0][1]).toEqual(['h', 'u1'])
  })

  it('touchLastLogin → SET last_login_at = now()', async () => {
    const c = mockClient([])
    await userRepo.touchLastLogin(c, 'u1')
    expect(c.query.mock.calls[0][0]).toMatch(/SET last_login_at = now\(\)/)
    expect(c.query.mock.calls[0][1]).toEqual(['u1'])
  })

  it('list → sin filtros: pending_approval=FALSE + revoked_at IS NULL', async () => {
    const c = mockClient([{ id: 'u1' }])
    const r = await userRepo.list(c, {})
    expect(c.query.mock.calls[0][0]).toMatch(/pending_approval = FALSE/)
    expect(c.query.mock.calls[0][0]).toMatch(/revoked_at IS NULL/)
    expect(c.query.mock.calls[0][1]).toEqual([])
    expect(r).toEqual([{ id: 'u1' }])
  })

  it('list → con appId+tenantId+role string', async () => {
    const c = mockClient([])
    await userRepo.list(c, { appId: 'app', tenantId: 't1', role: 'admin' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/app_id    = \$1/)
    expect(sql).toMatch(/tenant_id = \$2/)
    expect(sql).toMatch(/role IN \(\$3\)/)
    expect(params).toEqual(['app', 't1', 'admin'])
  })

  it('list → role array → IN con varios placeholders', async () => {
    const c = mockClient([])
    await userRepo.list(c, { role: ['admin', 'owner'] })
    expect(c.query.mock.calls[0][0]).toMatch(/role IN \(\$1, \$2\)/)
    expect(c.query.mock.calls[0][1]).toEqual(['admin', 'owner'])
  })

  it('list → pending=approval → pending_approval = TRUE', async () => {
    const c = mockClient([])
    await userRepo.list(c, { pending: 'approval' })
    expect(c.query.mock.calls[0][0]).toMatch(/pending_approval = TRUE/)
  })

  it('findAnywhereById → row + null', async () => {
    const c = mockClient([{ id: 'u1' }])
    expect(await userRepo.findAnywhereById(c, 'u1')).toEqual({ id: 'u1' })
    expect(c.query.mock.calls[0][1]).toEqual(['u1'])
    const c2 = mockClient([])
    expect(await userRepo.findAnywhereById(c2, 'u1')).toBeNull()
  })

  it('updateRole → SET role; row + null', async () => {
    const c = mockClient([{ id: 'u1', role: 'admin' }])
    expect(await userRepo.updateRole(c, 'u1', 'admin')).toEqual({ id: 'u1', role: 'admin' })
    expect(c.query.mock.calls[0][1]).toEqual(['u1', 'admin'])
    const c2 = mockClient([])
    expect(await userRepo.updateRole(c2, 'u1', 'admin')).toBeNull()
  })

  it('softDelete → SET revoked_at; rowCount>0 → true/false', async () => {
    const c = mockClientCount(1)
    expect(await userRepo.softDelete(c, 'u1')).toBe(true)
    expect(c.query.mock.calls[0][0]).toMatch(/SET revoked_at = now\(\) WHERE id = \$1 AND revoked_at IS NULL/)
    const c2 = mockClientCount(0)
    expect(await userRepo.softDelete(c2, 'u1')).toBe(false)
  })

  it('hardDelete → DELETE FROM users; rowCount>0', async () => {
    const c = mockClientCount(1)
    expect(await userRepo.hardDelete(c, 'u1')).toBe(true)
    expect(c.query.mock.calls[0][0]).toMatch(/DELETE FROM platform_auth\.users/)
    const c2 = mockClientCount(0)
    expect(await userRepo.hardDelete(c2, 'u1')).toBe(false)
  })

  it('approve → pending_approval=FALSE WHERE pending_approval=TRUE; row + null', async () => {
    const c = mockClient([{ id: 'u1' }])
    expect(await userRepo.approve(c, 'u1')).toEqual({ id: 'u1' })
    expect(c.query.mock.calls[0][0]).toMatch(/SET pending_approval = FALSE/)
    expect(c.query.mock.calls[0][0]).toMatch(/WHERE id = \$1 AND pending_approval = TRUE/)
    const c2 = mockClient([])
    expect(await userRepo.approve(c2, 'u1')).toBeNull()
  })

  it('updateProfile → COALESCE display_name; row + null', async () => {
    const c = mockClient([{ id: 'u1' }])
    expect(await userRepo.updateProfile(c, 'u1', { displayName: 'Ana' })).toEqual({ id: 'u1' })
    expect(c.query.mock.calls[0][0]).toMatch(/display_name = COALESCE\(\$2, display_name\)/)
    expect(c.query.mock.calls[0][1]).toEqual(['u1', 'Ana'])
    // displayName ausente → null
    const c2 = mockClient([])
    expect(await userRepo.updateProfile(c2, 'u1', {})).toBeNull()
    expect(c2.query.mock.calls[0][1]).toEqual(['u1', null])
  })
})
