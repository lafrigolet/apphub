import { describe, it, expect, vi, beforeEach } from 'vitest'

// Stub envs BEFORE importing the service (env.js reads on import).
vi.mock('../lib/env.js', () => ({
  env: {
    NODE_ENV: 'test', LOG_LEVEL: 'error',
    DATABASE_URL: 'postgresql://x@y/z',
    REDIS_URL:    'redis://localhost',
    S3_ENDPOINT:  'http://minio:9000',
    S3_PUBLIC_ENDPOINT: 'http://localhost:9000',
    S3_REGION:    'us-east-1',
    S3_ACCESS_KEY: 'k',
    S3_SECRET_KEY: 's',
    S3_BUCKET:    'apphub',
    S3_FORCE_PATH_STYLE: true,
  },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn() },
  withTenantTransaction: vi.fn(),
}))
vi.mock('../lib/redis.js', () => ({ publish: vi.fn() }))
vi.mock('../repositories/storage.repository.js')

// Mock the SDK presigner — service code only sees the urls it returns.
vi.mock('@apphub/platform-sdk/storage', () => ({
  createStorageClient: vi.fn(() => ({ /* stub client */ })),
  presignPut:  vi.fn().mockResolvedValue('http://minio:9000/apphub/k?signed=put'),
  presignGet:  vi.fn().mockResolvedValue('http://minio:9000/apphub/k?signed=get'),
  headObject:  vi.fn(),
  deleteObject: vi.fn(),
}))
// Module-local S3 extras (Content-Disposition GET + HeadBucket).
vi.mock('../lib/s3-extra.js', () => ({
  presignGetWithDisposition: vi.fn().mockResolvedValue('http://minio:9000/apphub/k?signed=get&disp=1'),
  headBucket: vi.fn(),
}))

import * as service from '../services/storage.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/storage.repository.js'
import { ConflictError, NotFoundError, ValidationError, ForbiddenError } from '@apphub/platform-sdk/errors'
import * as sdkStorage from '@apphub/platform-sdk/storage'
import * as s3extra from '../lib/s3-extra.js'
import { QuotaExceededError } from '../utils/errors.js'

const APP_ID    = 'yoga-studio'
const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const USER_ID   = '11111111-1111-1111-1111-111111111111'
const OBJ_ID    = '22222222-2222-2222-2222-222222222222'

const ctx = { appId: APP_ID, tenantId: TENANT_ID, subTenantId: null, userId: USER_ID, role: 'user' }
const staffCtx = { ...ctx, role: 'staff' }

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
})

// ── requestUpload ────────────────────────────────────────────────────
describe('requestUpload', () => {
  it('rejects unknown kind', async () => {
    await expect(service.requestUpload(ctx, { kind: 'foo', contentType: 'image/png', sizeBytes: 100 }))
      .rejects.toThrow(ValidationError)
  })

  it('rejects content-type not in kind allowlist', async () => {
    await expect(service.requestUpload(ctx, {
      kind: 'menu_photo', contentType: 'application/x-msdownload', sizeBytes: 100,
    })).rejects.toThrow(/not allowed/)
  })

  it('rejects size > kind maxBytes', async () => {
    await expect(service.requestUpload(ctx, {
      kind: 'signature', contentType: 'image/png', sizeBytes: 99 * 1024 * 1024,  // > 1 MB cap
    })).rejects.toThrow(/exceeds limit/)
  })

  it('rejects sizeBytes <= 0', async () => {
    await expect(service.requestUpload(ctx, {
      kind: 'menu_photo', contentType: 'image/png', sizeBytes: 0,
    })).rejects.toThrow(/positive/)
  })

  it('inserts pending row with computed retention_until and returns presigned URL', async () => {
    repo.insert.mockResolvedValue({
      id: OBJ_ID, app_id: APP_ID, tenant_id: TENANT_ID,
      bucket: 'apphub', key: `${APP_ID}/${TENANT_ID}/${OBJ_ID}`,
    })
    const r = await service.requestUpload(ctx, {
      kind: 'signature', contentType: 'image/png', sizeBytes: 500,
    })
    expect(repo.insert).toHaveBeenCalledWith(
      expect.anything(), APP_ID, TENANT_ID,
      expect.objectContaining({
        kind: 'signature',
        contentType: 'image/png',
        sizeBytes: 500,
        retentionUntil: expect.any(String),  // 7 years from now
      }),
    )
    // PUT URL host should be rewritten to the public endpoint.
    expect(r.uploadUrl).toContain('localhost:9000')
    expect(r.headers['Content-Type']).toBe('image/png')
    expect(r.headers['Content-Length']).toBe('500')
  })

  it('null retention for menu_photo (no expiry)', async () => {
    repo.insert.mockResolvedValue({ id: OBJ_ID, bucket: 'apphub', key: 'k' })
    await service.requestUpload(ctx, {
      kind: 'menu_photo', contentType: 'image/jpeg', sizeBytes: 1000,
    })
    expect(repo.insert).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID,
      expect.objectContaining({ retentionUntil: null }),
    )
  })
})

// ── finalize ─────────────────────────────────────────────────────────
describe('finalize', () => {
  it('throws NotFoundError when missing', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(service.finalize(ctx, OBJ_ID)).rejects.toThrow(NotFoundError)
  })

  it('idempotent: returns the row when already uploaded', async () => {
    repo.findById.mockResolvedValue({ id: OBJ_ID, status: 'uploaded' })
    const r = await service.finalize(ctx, OBJ_ID)
    expect(r.status).toBe('uploaded')
    expect(sdkStorage.headObject).not.toHaveBeenCalled()
  })

  it('rejects deleted objects', async () => {
    repo.findById.mockResolvedValue({ id: OBJ_ID, status: 'deleted' })
    await expect(service.finalize(ctx, OBJ_ID)).rejects.toThrow(ConflictError)
  })

  it('translates 404 from MinIO into "upload not yet visible"', async () => {
    repo.findById.mockResolvedValue({ id: OBJ_ID, status: 'pending', bucket: 'apphub', key: 'k' })
    sdkStorage.headObject.mockRejectedValue(Object.assign(new Error('not found'), {
      $metadata: { httpStatusCode: 404 },
    }))
    await expect(service.finalize(ctx, OBJ_ID)).rejects.toThrow(/not yet visible/)
  })

  it('rethrows non-404 errors from headObject (e.g. 500)', async () => {
    repo.findById.mockResolvedValue({ id: OBJ_ID, status: 'pending', bucket: 'apphub', key: 'k' })
    sdkStorage.headObject.mockRejectedValue(Object.assign(new Error('server error'), {
      $metadata: { httpStatusCode: 500 },
    }))
    await expect(service.finalize(ctx, OBJ_ID)).rejects.toThrow(/server error/)
  })

  it('rejects size mismatch', async () => {
    repo.findById.mockResolvedValue({
      id: OBJ_ID, status: 'pending', bucket: 'apphub', key: 'k', size_bytes: 500,
    })
    sdkStorage.headObject.mockResolvedValue({ ContentLength: 999, ETag: '"abc"' })
    await expect(service.finalize(ctx, OBJ_ID)).rejects.toThrow(/size mismatch/)
  })

  it('marks uploaded, stamps sha256 from ETag, publishes event', async () => {
    repo.findById.mockResolvedValue({
      id: OBJ_ID, status: 'pending', bucket: 'apphub', key: 'k',
      size_bytes: 500, kind: 'menu_photo', content_type: 'image/png',
    })
    sdkStorage.headObject.mockResolvedValue({ ContentLength: 500, ETag: '"abc123"' })
    repo.markUploaded.mockResolvedValue({
      id: OBJ_ID, status: 'uploaded', kind: 'menu_photo', content_type: 'image/png',
    })

    await service.finalize(ctx, OBJ_ID)
    expect(repo.markUploaded).toHaveBeenCalledWith(
      expect.anything(), APP_ID, TENANT_ID, OBJ_ID,
      { sizeBytes: 500, sha256: 'abc123' },
    )
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'storage.object.uploaded',
      payload: expect.objectContaining({ objectId: OBJ_ID }),
    }))
  })
})

// ── getDownloadUrl ───────────────────────────────────────────────────
describe('getDownloadUrl', () => {
  it('throws ConflictError if object is not uploaded', async () => {
    repo.findById.mockResolvedValue({ id: OBJ_ID, status: 'pending' })
    await expect(service.getDownloadUrl(ctx, OBJ_ID)).rejects.toThrow(ConflictError)
  })

  it('returns rewritten host + expiresAt', async () => {
    repo.findById.mockResolvedValue({ id: OBJ_ID, status: 'uploaded', bucket: 'apphub', key: 'k' })
    const r = await service.getDownloadUrl(ctx, OBJ_ID, 60)
    expect(r.downloadUrl).toContain('localhost:9000')
    expect(new Date(r.expiresAt).getTime()).toBeGreaterThan(Date.now() + 50_000)
  })
})

// ── getPublicDownloadUrl ─────────────────────────────────────────────
describe('getPublicDownloadUrl', () => {
  const pubCtx = { appId: 'aulavera', tenantId: TENANT_ID }

  it('throws NotFoundError when missing', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(service.getPublicDownloadUrl(pubCtx, OBJ_ID)).rejects.toThrow(NotFoundError)
  })

  it('throws ForbiddenError when the kind is not public', async () => {
    repo.findById.mockResolvedValue({ id: OBJ_ID, kind: 'menu_photo', status: 'uploaded', bucket: 'apphub', key: 'k' })
    await expect(service.getPublicDownloadUrl(pubCtx, OBJ_ID)).rejects.toThrow(ForbiddenError)
  })

  it('throws ConflictError when not yet uploaded', async () => {
    repo.findById.mockResolvedValue({ id: OBJ_ID, kind: 'public_download', status: 'pending', bucket: 'apphub', key: 'k' })
    await expect(service.getPublicDownloadUrl(pubCtx, OBJ_ID)).rejects.toThrow(ConflictError)
  })

  it('returns presigned URL (rewritten host) for a public kind', async () => {
    repo.findById.mockResolvedValue({ id: OBJ_ID, kind: 'public_download', status: 'uploaded', bucket: 'apphub', key: 'k' })
    const r = await service.getPublicDownloadUrl(pubCtx, OBJ_ID, 120)
    expect(s3extra.presignGetWithDisposition).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ttlSeconds: 120 }))
    expect(repo.insertAccessLog).toHaveBeenCalledWith(expect.anything(), 'aulavera', TENANT_ID,
      expect.objectContaining({ action: 'download', userId: null }))
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'storage.object.downloaded' }))
    expect(r.downloadUrl).toContain('localhost:9000')
  })
})

// ── deleteObject ─────────────────────────────────────────────────────
describe('deleteObject', () => {
  it('throws NotFoundError when missing', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(service.deleteObject(ctx, OBJ_ID)).rejects.toThrow(NotFoundError)
  })

  it('rejects non-owner non-staff', async () => {
    repo.findById.mockResolvedValue({ id: OBJ_ID, owner_user_id: 'someone-else', status: 'uploaded' })
    await expect(service.deleteObject(ctx, OBJ_ID)).rejects.toThrow(ForbiddenError)
  })

  it('owner can delete own object', async () => {
    repo.findById.mockResolvedValue({ id: OBJ_ID, owner_user_id: USER_ID, status: 'uploaded', kind: 'menu_photo' })
    repo.softDelete.mockResolvedValue({ id: OBJ_ID, status: 'deleted', kind: 'menu_photo' })
    await service.deleteObject(ctx, OBJ_ID)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'storage.object.deleted' }))
  })

  it('staff can delete any tenant object', async () => {
    repo.findById.mockResolvedValue({ id: OBJ_ID, owner_user_id: 'someone-else', status: 'uploaded', kind: 'menu_photo' })
    repo.softDelete.mockResolvedValue({ id: OBJ_ID, status: 'deleted', kind: 'menu_photo' })
    await service.deleteObject(staffCtx, OBJ_ID)
    expect(repo.softDelete).toHaveBeenCalled()
  })

  it('idempotent: returns row when already deleted', async () => {
    repo.findById.mockResolvedValue({ id: OBJ_ID, owner_user_id: USER_ID, status: 'deleted' })
    const r = await service.deleteObject(ctx, OBJ_ID)
    expect(r.status).toBe('deleted')
    expect(repo.softDelete).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })
})

// ── getObject / listObjects ─────────────────────────────────────────
describe('reads', () => {
  it('getObject returns metadata', async () => {
    repo.findById.mockResolvedValue({ id: OBJ_ID })
    const r = await service.getObject(ctx, OBJ_ID)
    expect(r.id).toBe(OBJ_ID)
  })

  it('getObject throws NotFoundError when missing', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(service.getObject(ctx, OBJ_ID)).rejects.toThrow(NotFoundError)
  })

  it('listObjects passes filters', async () => {
    repo.listByTenant.mockResolvedValue([])
    await service.listObjects(ctx, { kind: 'menu_photo', limit: 50 })
    expect(repo.listByTenant).toHaveBeenCalledWith(
      expect.anything(), APP_ID, TENANT_ID, { kind: 'menu_photo', limit: 50 },
    )
  })
})
