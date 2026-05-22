// storage.service.requestUpload + finalize + getDownloadUrl.
// Contrato:
//   - requestUpload valida kind/mime/size ANTES de insertar:
//       · kind desconocido → ValidationError.
//       · MIME no permitido para ese kind → ValidationError.
//       · sizeBytes <= 0 o > maxBytes → ValidationError.
//   - Devuelve { objectId, uploadUrl, expiresAt, headers } con Content-Type + Content-Length.
//   - retentionUntil derivado de kindCfg.retentionDays (null = sin caducidad).
//   - finalize:
//       · Idempotente: status='uploaded' → devuelve row sin re-presign.
//       · status='deleted' → ConflictError.
//       · headObject 404 → ConflictError 'upload not yet visible'.
//       · size mismatch → ConflictError.
//   - getDownloadUrl: status != 'uploaded' → ConflictError.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL_STORAGE: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({ pool: {}, withTenantTransaction: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ publish: vi.fn() }))
vi.mock('../lib/settings.js', () => ({
  getSettings: () => ({
    bucket: 'test-bucket',
    endpoint: 'http://minio:9000',
    publicEndpoint: 'http://localhost:9000',
    region: 'us-east-1',
    accessKey: 'a', secretKey: 'b', forcePathStyle: true,
  }),
}))
vi.mock('@apphub/platform-sdk/storage', () => ({
  createStorageClient: vi.fn(() => ({ _client: true })),
  presignPut: vi.fn(async () => 'http://minio:9000/test-bucket/obj?sig=upload'),
  presignGet: vi.fn(async () => 'http://minio:9000/test-bucket/obj?sig=download'),
  headObject: vi.fn(),
}))
vi.mock('../repositories/storage.repository.js')

import {
  requestUpload, finalize, getDownloadUrl, deleteObject, configureClient,
} from '../services/storage.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import { headObject, presignPut } from '@apphub/platform-sdk/storage'
import * as repo from '../repositories/storage.repository.js'

const ctx = {
  appId: 'aikikan',
  tenantId: '22222222-2222-2222-2222-222222222222',
  subTenantId: null,
  userId: 'user-1',
  role: 'user',
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn({}))
  configureClient({ _client: true })   // skip lazy init
})

// ── requestUpload — validaciones ─────────────────────────────────────

describe('requestUpload validation', () => {
  it('kind desconocido → ValidationError', async () => {
    await expect(requestUpload(ctx, {
      kind: 'not_a_real_kind', contentType: 'image/png', sizeBytes: 100, filename: 'a',
    })).rejects.toMatchObject({ statusCode: 422, message: expect.stringContaining('unknown kind') })
  })

  it('MIME no permitido para el kind → ValidationError', async () => {
    await expect(requestUpload(ctx, {
      kind: 'signature', contentType: 'image/jpeg', sizeBytes: 100, filename: 'sig.jpg',
    })).rejects.toMatchObject({ statusCode: 422, message: expect.stringContaining('not allowed') })
  })

  it('sizeBytes <= 0 → ValidationError', async () => {
    await expect(requestUpload(ctx, {
      kind: 'signature', contentType: 'image/png', sizeBytes: 0, filename: 'a',
    })).rejects.toMatchObject({ statusCode: 422, message: expect.stringContaining('positive integer') })
  })

  it('sizeBytes > maxBytes (signature=1MB) → ValidationError', async () => {
    await expect(requestUpload(ctx, {
      kind: 'signature', contentType: 'image/png', sizeBytes: 2 * 1024 * 1024, filename: 'huge.png',
    })).rejects.toMatchObject({ statusCode: 422, message: expect.stringContaining('exceeds limit') })
  })

  it('sizeBytes no-number → ValidationError', async () => {
    await expect(requestUpload(ctx, {
      kind: 'signature', contentType: 'image/png', sizeBytes: 'big', filename: 'a',
    })).rejects.toMatchObject({ statusCode: 422 })
  })
})

// ── requestUpload — happy path ───────────────────────────────────────

describe('requestUpload happy path', () => {
  it('INSERT row + presignPut + rewrite public host', async () => {
    repo.insert.mockResolvedValue({
      id: 'obj-1', key: 'aikikan/tenant/obj-1', bucket: 'test-bucket',
    })
    const r = await requestUpload(ctx, {
      kind: 'menu_photo', contentType: 'image/png', sizeBytes: 1024, filename: 'pic.png',
    })

    expect(r.objectId).toBe('obj-1')
    // rewriteHost: minio:9000 → localhost:9000
    expect(r.uploadUrl).toContain('http://localhost:9000')
    expect(r.uploadUrl).not.toContain('http://minio:9000')
    expect(r.headers['Content-Type']).toBe('image/png')
    expect(r.headers['Content-Length']).toBe('1024')
    expect(typeof r.expiresAt).toBe('string')

    expect(presignPut).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      bucket: 'test-bucket', key: 'aikikan/tenant/obj-1', contentType: 'image/png',
      contentLength: 1024, ttlSeconds: 600,
    }))
  })

  it('retentionUntil = NULL para kinds sin retentionDays (menu_photo)', async () => {
    repo.insert.mockResolvedValue({ id: 'obj-1', key: 'k', bucket: 'b' })
    await requestUpload(ctx, {
      kind: 'menu_photo', contentType: 'image/jpeg', sizeBytes: 100, filename: 'a',
    })
    expect(repo.insert).toHaveBeenCalledWith(expect.anything(), ctx.appId, ctx.tenantId,
      expect.objectContaining({ retentionUntil: null }))
  })

  it('retentionUntil = ISO date para kinds con retentionDays (invoice=7y)', async () => {
    repo.insert.mockResolvedValue({ id: 'obj-1', key: 'k', bucket: 'b' })
    await requestUpload(ctx, {
      kind: 'invoice', contentType: 'application/pdf', sizeBytes: 100, filename: 'a.pdf',
    })
    const callArgs = repo.insert.mock.calls[0][3]
    expect(callArgs.retentionUntil).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(new Date(callArgs.retentionUntil).getTime()).toBeGreaterThan(Date.now())
  })
})

// ── finalize ─────────────────────────────────────────────────────────

describe('finalize', () => {
  it('idempotente: status="uploaded" → devuelve row, no headObject', async () => {
    const existing = { id: 'obj-1', status: 'uploaded', bucket: 'b', key: 'k' }
    repo.findById.mockResolvedValue(existing)
    const r = await finalize(ctx, 'obj-1')
    expect(r).toBe(existing)
    expect(headObject).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()                  // no re-emite el evento
  })

  it('object no existe → NotFoundError', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(finalize(ctx, 'ghost')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('object status="deleted" → ConflictError', async () => {
    repo.findById.mockResolvedValue({ id: 'obj-1', status: 'deleted' })
    await expect(finalize(ctx, 'obj-1')).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('deleted') })
  })

  it('headObject 404 (S3) → ConflictError "not yet visible"', async () => {
    repo.findById.mockResolvedValue({ id: 'obj-1', status: 'pending', bucket: 'b', key: 'k' })
    headObject.mockRejectedValue({ $metadata: { httpStatusCode: 404 } })
    await expect(finalize(ctx, 'obj-1')).rejects.toMatchObject({
      statusCode: 409, message: expect.stringContaining('not yet visible'),
    })
  })

  it('size mismatch (declared ≠ found) → ConflictError', async () => {
    repo.findById.mockResolvedValue({ id: 'obj-1', status: 'pending', bucket: 'b', key: 'k', size_bytes: 1000 })
    headObject.mockResolvedValue({ ContentLength: 2000, ETag: '"abc"' })
    await expect(finalize(ctx, 'obj-1')).rejects.toMatchObject({
      statusCode: 409, message: expect.stringContaining('size mismatch'),
    })
  })

  it('happy: markUploaded + publish storage.object.uploaded', async () => {
    repo.findById.mockResolvedValue({ id: 'obj-1', status: 'pending', bucket: 'b', key: 'k', size_bytes: 1000 })
    repo.markUploaded.mockResolvedValue({
      id: 'obj-1', kind: 'invoice', content_type: 'application/pdf',
    })
    headObject.mockResolvedValue({ ContentLength: 1000, ETag: '"deadbeef"' })

    await finalize(ctx, 'obj-1')
    expect(repo.markUploaded).toHaveBeenCalledWith(
      expect.anything(), ctx.appId, ctx.tenantId, 'obj-1',
      { sizeBytes: 1000, sha256: 'deadbeef' },
    )
    expect(publish).toHaveBeenCalledWith({
      type: 'storage.object.uploaded',
      payload: expect.objectContaining({
        appId: ctx.appId, tenantId: ctx.tenantId, objectId: 'obj-1',
        kind: 'invoice', sizeBytes: 1000, contentType: 'application/pdf',
      }),
    })
  })

  it('etag con comillas se limpia para sha256', async () => {
    repo.findById.mockResolvedValue({ id: 'obj-1', status: 'pending', bucket: 'b', key: 'k', size_bytes: null })
    repo.markUploaded.mockResolvedValue({ id: 'obj-1', kind: 'invoice', content_type: 'application/pdf' })
    headObject.mockResolvedValue({ ContentLength: 500, ETag: '"abc123"' })
    await finalize(ctx, 'obj-1')
    expect(repo.markUploaded).toHaveBeenCalledWith(
      expect.anything(), expect.any(String), expect.any(String), 'obj-1',
      expect.objectContaining({ sha256: 'abc123' }),
    )
  })
})

// ── getDownloadUrl ───────────────────────────────────────────────────

describe('getDownloadUrl', () => {
  it('happy: presignGet + rewrite host', async () => {
    repo.findById.mockResolvedValue({
      id: 'obj-1', status: 'uploaded', bucket: 'b', key: 'k',
    })
    const r = await getDownloadUrl(ctx, 'obj-1', 300)
    expect(r.downloadUrl).toContain('http://localhost:9000')
    expect(typeof r.expiresAt).toBe('string')
  })
  it('status pending → ConflictError', async () => {
    repo.findById.mockResolvedValue({ id: 'obj-1', status: 'pending' })
    await expect(getDownloadUrl(ctx, 'obj-1')).rejects.toMatchObject({
      statusCode: 409, message: expect.stringContaining('pending'),
    })
  })
  it('status deleted → ConflictError', async () => {
    repo.findById.mockResolvedValue({ id: 'obj-1', status: 'deleted' })
    await expect(getDownloadUrl(ctx, 'obj-1')).rejects.toMatchObject({
      statusCode: 409, message: expect.stringContaining('deleted'),
    })
  })
})

// ── deleteObject — guard de owner ────────────────────────────────────

describe('deleteObject — owner/staff guard', () => {
  it('owner puede borrar su propio object', async () => {
    repo.findById.mockResolvedValue({
      id: 'obj-1', status: 'uploaded', owner_user_id: 'user-1', kind: 'invoice',
    })
    repo.softDelete.mockResolvedValue({ id: 'obj-1', kind: 'invoice' })
    await deleteObject(ctx, 'obj-1')
    expect(repo.softDelete).toHaveBeenCalled()
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'storage.object.deleted' }))
  })
  it('user que NO es owner ni staff → ForbiddenError', async () => {
    repo.findById.mockResolvedValue({ id: 'obj-1', owner_user_id: 'other-user', kind: 'invoice', status: 'uploaded' })
    await expect(deleteObject(ctx, 'obj-1')).rejects.toMatchObject({
      statusCode: 403, message: expect.stringContaining('only the owner or staff'),
    })
    expect(repo.softDelete).not.toHaveBeenCalled()
  })
  it('staff puede borrar object de otro user', async () => {
    repo.findById.mockResolvedValue({ id: 'obj-1', owner_user_id: 'other-user', kind: 'invoice', status: 'uploaded' })
    repo.softDelete.mockResolvedValue({ id: 'obj-1', kind: 'invoice' })
    await deleteObject({ ...ctx, role: 'staff' }, 'obj-1')
    expect(repo.softDelete).toHaveBeenCalled()
  })
  it('borrar object ya deleted → idempotente (no publish, no softDelete)', async () => {
    repo.findById.mockResolvedValue({ id: 'obj-1', owner_user_id: 'user-1', kind: 'invoice', status: 'deleted' })
    await deleteObject(ctx, 'obj-1')
    expect(repo.softDelete).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })
})
