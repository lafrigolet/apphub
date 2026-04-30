/**
 * Integration tests for platform/storage — require a running Postgres + Redis + MinIO.
 *
 * Start dependencies:  docker compose up -d postgres redis minio minio-init
 * Run:                 pnpm --filter @apphub/platform-storage test:integration
 *
 * Tests use APP_ID 'int-test-storage' so cleanup is scoped and never touches
 * real tenants.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import pg from 'pg'
import { v4 as uuidv4 } from 'uuid'

import { runMigrations } from '../../lib/migrate.js'
import {
  requestUpload, finalize, getObject, getDownloadUrl, deleteObject, listObjects,
} from '../../services/storage.service.js'
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors.js'

const APP_ID    = 'int-test-storage'
const TENANT_ID = '00000000-0000-0000-0000-000000000aa1'

let adminPool

beforeAll(async () => {
  await runMigrations(process.env.MIGRATION_DATABASE_URL)
  adminPool = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL })
  await adminPool.query('SELECT 1')
})

afterAll(async () => {
  await adminPool.end()
})

afterEach(async () => {
  await adminPool.query(`DELETE FROM platform_storage.objects WHERE app_id = $1`, [APP_ID])
})

const ctx = (overrides = {}) => ({
  appId: APP_ID, tenantId: TENANT_ID, subTenantId: null,
  userId: '11111111-1111-1111-1111-111111111111', role: 'user', ...overrides,
})

// Tiny PNG to upload (1×1 pixel, ~70 bytes).
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108020000009077' +
  '53de0000000c4944415408d76360000002000100090a3b58e30000000049454e44ae426082',
  'hex',
)

// Helper: PUT bytes to a presigned URL. Browser would do this directly.
async function putBytes(uploadUrl, headers, body) {
  // The presigned URL has the bucket+key+sig; we just hit it.
  // S3_PUBLIC_ENDPOINT defaults to S3_ENDPOINT in tests (no rewrite needed).
  const res = await fetch(uploadUrl, { method: 'PUT', headers, body })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`PUT failed: ${res.status} ${text}`)
  }
}

// ── full lifecycle ───────────────────────────────────────────────────
describe('full upload lifecycle', () => {
  it('requestUpload → PUT bytes → finalize → download → delete', async () => {
    // 1. mint upload
    const upload = await requestUpload(ctx(), {
      kind: 'menu_photo',
      contentType: 'image/png',
      sizeBytes: PNG.length,
      filename: 'tiny.png',
    })
    expect(upload.objectId).toMatch(/^[0-9a-f-]{36}$/)
    expect(upload.uploadUrl).toContain('/apphub/')
    expect(upload.headers['Content-Type']).toBe('image/png')

    // 2. PUT bytes directly to MinIO using the presigned URL.
    await putBytes(upload.uploadUrl, upload.headers, PNG)

    // 3. finalize — service does HEAD against MinIO and transitions.
    const final = await finalize(ctx(), upload.objectId)
    expect(final.status).toBe('uploaded')
    expect(Number(final.size_bytes)).toBe(PNG.length)
    expect(final.finalized_at).toBeTruthy()

    // 4. download URL
    const dl = await getDownloadUrl(ctx(), upload.objectId, 60)
    expect(dl.downloadUrl).toContain('/apphub/')
    const fetched = await fetch(dl.downloadUrl)
    expect(fetched.ok).toBe(true)
    const bytes = Buffer.from(await fetched.arrayBuffer())
    expect(bytes.length).toBe(PNG.length)

    // 5. soft-delete
    await deleteObject(ctx(), upload.objectId)
    const after = await getObject(ctx(), upload.objectId)
    expect(after.status).toBe('deleted')

    // download URL no longer obtainable
    await expect(getDownloadUrl(ctx(), upload.objectId)).rejects.toThrow(ConflictError)
  })

  it('finalize is idempotent (can be called twice)', async () => {
    const upload = await requestUpload(ctx(), {
      kind: 'menu_photo', contentType: 'image/png', sizeBytes: PNG.length,
    })
    await putBytes(upload.uploadUrl, upload.headers, PNG)
    const a = await finalize(ctx(), upload.objectId)
    const b = await finalize(ctx(), upload.objectId)
    expect(a.status).toBe('uploaded')
    expect(b.status).toBe('uploaded')
    expect(b.id).toBe(a.id)
  })

  it('rejects MIME not in allowlist', async () => {
    await expect(requestUpload(ctx(), {
      kind: 'menu_photo', contentType: 'application/x-msdownload', sizeBytes: 100,
    })).rejects.toThrow(ValidationError)
  })

  it('rejects size > maxBytes for kind', async () => {
    await expect(requestUpload(ctx(), {
      kind: 'signature', contentType: 'image/png', sizeBytes: 2 * 1024 * 1024,  // > 1 MB cap
    })).rejects.toThrow(/exceeds limit/)
  })

  it('signature retention_until is roughly 7 years out', async () => {
    const upload = await requestUpload(ctx(), {
      kind: 'signature', contentType: 'image/png', sizeBytes: PNG.length,
    })
    const obj = await getObject(ctx(), upload.objectId)
    const yearsOut = (new Date(obj.retention_until).getTime() - Date.now()) / (365 * 24 * 60 * 60 * 1000)
    expect(yearsOut).toBeGreaterThan(6.9)
    expect(yearsOut).toBeLessThan(7.1)
  })

  it('menu_photo retention_until is null (no expiry)', async () => {
    const upload = await requestUpload(ctx(), {
      kind: 'menu_photo', contentType: 'image/png', sizeBytes: PNG.length,
    })
    const obj = await getObject(ctx(), upload.objectId)
    expect(obj.retention_until).toBeNull()
  })
})

// ── finalize edge cases ──────────────────────────────────────────────
describe('finalize edge cases', () => {
  it('throws NotFoundError on unknown id', async () => {
    await expect(finalize(ctx(), uuidv4())).rejects.toThrow(NotFoundError)
  })

  it('rejects when bytes have not been uploaded yet (404 from MinIO)', async () => {
    // Mint an upload but DON'T PUT — finalize should refuse.
    const upload = await requestUpload(ctx(), {
      kind: 'menu_photo', contentType: 'image/png', sizeBytes: 100,
    })
    await expect(finalize(ctx(), upload.objectId)).rejects.toThrow(/not yet visible/)
  })
})

// ── tenant isolation ─────────────────────────────────────────────────
describe('tenant isolation', () => {
  it('listObjects only returns objects for the calling tenant', async () => {
    const T2 = '00000000-0000-0000-0000-000000000aa2'
    await requestUpload(ctx(), { kind: 'menu_photo', contentType: 'image/png', sizeBytes: 100 })
    await requestUpload(ctx({ tenantId: T2 }), { kind: 'menu_photo', contentType: 'image/png', sizeBytes: 100 })
    const own = await listObjects(ctx(), {})
    expect(own.every((o) => o.tenant_id === TENANT_ID)).toBe(true)
    await adminPool.query(`DELETE FROM platform_storage.objects WHERE app_id = $1 AND tenant_id = $2`, [APP_ID, T2])
  })
})

// ── delete authorization ─────────────────────────────────────────────
describe('delete authorization', () => {
  it('non-owner non-staff cannot delete', async () => {
    const upload = await requestUpload(ctx(), { kind: 'menu_photo', contentType: 'image/png', sizeBytes: 100 })
    const otherCtx = ctx({ userId: '99999999-9999-9999-9999-999999999999', role: 'user' })
    await expect(deleteObject(otherCtx, upload.objectId)).rejects.toThrow(/owner or staff/)
  })

  it('staff can delete any tenant object', async () => {
    const upload = await requestUpload(ctx(), { kind: 'menu_photo', contentType: 'image/png', sizeBytes: 100 })
    const staffCtx = ctx({ userId: '99999999-9999-9999-9999-999999999999', role: 'staff' })
    const r = await deleteObject(staffCtx, upload.objectId)
    expect(r.status).toBe('deleted')
  })
})
