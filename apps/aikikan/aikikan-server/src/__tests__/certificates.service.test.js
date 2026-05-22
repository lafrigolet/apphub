// certificates.service — emisión y descarga de certificados aikikan.
// Contrato:
//   - issue: solo owner/admin → 403 si user; persiste con issuedByUserId=identity.userId.
//   - listMine: identity sin userId → 403; lista certificates activos (no revocados) del user.
//   - getDownloadUrl:
//       · Cert no existe → 404.
//       · No owner ni admin → ForbiddenError.
//       · Revocado (revoked_at != null) → AppError 410 CERTIFICATE_REVOKED.
//       · fetch a platform/storage falla → 502 STORAGE_UNREACHABLE.
//       · storage 4xx/5xx → propaga code y status del json.
//       · Devuelve { certificateId, url, expiresAt } extraídos del json.data.
//   - revoke: admin guard + 404 si no existe.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    NODE_ENV: 'test', LOG_LEVEL: 'error',
    DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost',
    PLATFORM_JWT_SECRET: 'test-secret-32-chars-xxxxxxxxxxxxxxx',
    PLATFORM_CORE_URL: 'http://platform-core:3000',
  },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({ pool: {}, withTenantTransaction: vi.fn() }))
vi.mock('../repositories/certificates.repository.js')

import {
  issue, listMine, getDownloadUrl, revoke,
} from '../services/certificates.service.js'
import { withTenantTransaction } from '../lib/db.js'
import * as repo from '../repositories/certificates.repository.js'

const APP    = 'aikikan'
const TENANT = '22222222-2222-2222-2222-222222222222'
const USER   = '11111111-1111-1111-1111-111111111111'
const CERT   = 'cert-1'

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn({}))
  global.fetch = vi.fn()
})

// ── issue (admin only) ──────────────────────────────────────────────

describe('issue', () => {
  it('rol "user" → ForbiddenError', async () => {
    await expect(issue(
      { userId: 'u1', appId: APP, tenantId: TENANT, role: 'user' },
      { userId: USER, kind: 'kyu_6', title: '6 Kyu', issuedAt: '2026-05-22' },
    )).rejects.toMatchObject({ statusCode: 403 })
  })

  it.each([['owner'], ['admin']])('rol "%s" → permitido', async (role) => {
    repo.insert.mockResolvedValue({ id: CERT })
    await issue(
      { userId: 'admin-1', appId: APP, tenantId: TENANT, role },
      { userId: USER, kind: 'kyu_6', title: '6 Kyu', issuedAt: '2026-05-22', fileObjectId: 'obj-1' },
    )
    expect(repo.insert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      userId: USER, issuedByUserId: 'admin-1',
      kind: 'kyu_6', title: '6 Kyu', fileObjectId: 'obj-1',
    }))
  })

  it('identity sin userId → 403', async () => {
    await expect(issue({ role: 'admin' }, { userId: USER, kind: 'k' }))
      .rejects.toMatchObject({ statusCode: 403 })
  })
})

// ── listMine ────────────────────────────────────────────────────────

describe('listMine', () => {
  it('happy: lista certs activos del user', async () => {
    repo.findActiveByUser.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }])
    const r = await listMine({ userId: USER, appId: APP, tenantId: TENANT, role: 'user' })
    expect(r).toHaveLength(2)
    expect(repo.findActiveByUser).toHaveBeenCalledWith(expect.anything(), USER)
  })

  it('identity sin userId → 403', async () => {
    await expect(listMine({})).rejects.toMatchObject({ statusCode: 403 })
  })
})

// ── getDownloadUrl ──────────────────────────────────────────────────

describe('getDownloadUrl — boundary y errores', () => {
  it('cert no existe → 404', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(getDownloadUrl(
      { userId: USER, appId: APP, tenantId: TENANT, role: 'user' }, 'tok', 'ghost',
    )).rejects.toMatchObject({ statusCode: 404 })
  })

  it('no owner ni admin → ForbiddenError', async () => {
    repo.findById.mockResolvedValue({ id: CERT, user_id: 'other-user' })
    await expect(getDownloadUrl(
      { userId: USER, appId: APP, tenantId: TENANT, role: 'user' }, 'tok', CERT,
    )).rejects.toMatchObject({ statusCode: 403 })
  })

  it('cert revocado → AppError 410 CERTIFICATE_REVOKED', async () => {
    repo.findById.mockResolvedValue({
      id: CERT, user_id: USER, revoked_at: '2026-04-01T00:00:00Z', file_object_id: 'obj-1',
    })
    await expect(getDownloadUrl(
      { userId: USER, appId: APP, tenantId: TENANT, role: 'user' }, 'tok', CERT,
    )).rejects.toMatchObject({ statusCode: 410, code: 'CERTIFICATE_REVOKED' })
  })

  it('fetch a storage falla (red) → AppError 502 STORAGE_UNREACHABLE', async () => {
    repo.findById.mockResolvedValue({ id: CERT, user_id: USER, revoked_at: null, file_object_id: 'obj-1' })
    global.fetch.mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(getDownloadUrl(
      { userId: USER, appId: APP, tenantId: TENANT, role: 'user' }, 'tok', CERT,
    )).rejects.toMatchObject({ statusCode: 502, code: 'STORAGE_UNREACHABLE' })
  })

  it('storage 404 → propaga code + statusCode del json', async () => {
    repo.findById.mockResolvedValue({ id: CERT, user_id: USER, revoked_at: null, file_object_id: 'obj-1' })
    global.fetch.mockResolvedValue({
      ok: false, status: 404,
      json: async () => ({ error: { code: 'OBJECT_NOT_FOUND', message: 'object not found' } }),
    })
    await expect(getDownloadUrl(
      { userId: USER, appId: APP, tenantId: TENANT, role: 'user' }, 'tok', CERT,
    )).rejects.toMatchObject({ statusCode: 404, code: 'OBJECT_NOT_FOUND' })
  })

  it('admin (no owner) puede descargar cert de OTRO user', async () => {
    repo.findById.mockResolvedValue({ id: CERT, user_id: 'someone-else', revoked_at: null, file_object_id: 'obj-1' })
    global.fetch.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ data: { url: 'https://signed.url', expiresAt: '2026-05-22T11:00:00Z' } }),
    })
    const r = await getDownloadUrl(
      { userId: 'admin-1', appId: APP, tenantId: TENANT, role: 'admin' }, 'tok', CERT,
    )
    expect(r.url).toBe('https://signed.url')
  })

  it('happy owner: GET /v1/storage/objects/<id>/download-url + Bearer token', async () => {
    repo.findById.mockResolvedValue({ id: CERT, user_id: USER, revoked_at: null, file_object_id: 'obj-1' })
    global.fetch.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ data: { url: 'https://signed.url', expiresAt: '2026-05-22T11:00:00Z' } }),
    })
    const r = await getDownloadUrl(
      { userId: USER, appId: APP, tenantId: TENANT, role: 'user' }, 'bearer-xyz', CERT,
    )
    expect(global.fetch).toHaveBeenCalledWith(
      'http://platform-core:3000/v1/storage/objects/obj-1/download-url',
      { headers: { Authorization: 'Bearer bearer-xyz' } },
    )
    expect(r).toEqual({ certificateId: CERT, url: 'https://signed.url', expiresAt: '2026-05-22T11:00:00Z' })
  })

  it('encodeURIComponent del file_object_id (anti-path-traversal en URL)', async () => {
    repo.findById.mockResolvedValue({
      id: CERT, user_id: USER, revoked_at: null,
      file_object_id: 'obj/with/slashes',
    })
    global.fetch.mockResolvedValue({
      ok: true, status: 200, json: async () => ({ data: { url: 'u' } }),
    })
    await getDownloadUrl({ userId: USER, appId: APP, tenantId: TENANT, role: 'user' }, 'tok', CERT)
    expect(global.fetch.mock.calls[0][0]).toContain('obj%2Fwith%2Fslashes')
  })
})

// ── revoke ──────────────────────────────────────────────────────────

describe('revoke', () => {
  it('rol "user" → ForbiddenError', async () => {
    await expect(revoke({ userId: USER, appId: APP, tenantId: TENANT, role: 'user' }, CERT))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('cert inexistente → NotFoundError 404', async () => {
    repo.revoke.mockResolvedValue(null)
    await expect(revoke({ userId: 'admin-1', appId: APP, tenantId: TENANT, role: 'admin' }, 'ghost'))
      .rejects.toMatchObject({ statusCode: 404 })
  })

  it('happy admin: revoke + retorna row', async () => {
    repo.revoke.mockResolvedValue({ id: CERT, revoked_at: '2026-05-22T10:00:00Z' })
    const r = await revoke({ userId: 'admin-1', appId: APP, tenantId: TENANT, role: 'admin' }, CERT)
    expect(r.revoked_at).toBe('2026-05-22T10:00:00Z')
  })
})
