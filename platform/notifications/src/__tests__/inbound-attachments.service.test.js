// inbound-attachments.service — policy gates (type/size), sha256 dedup,
// storage-unconfigured dev-stub and per-attachment failure isolation. The S3
// SDK and the provider download are mocked.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const env = vi.hoisted(() => ({
  NODE_ENV: 'test', S3_REGION: 'us-east-1', S3_BUCKET: 'apphub', S3_FORCE_PATH_STYLE: true,
  S3_ENDPOINT: undefined, S3_ACCESS_KEY: undefined, S3_SECRET_KEY: undefined,
}))
vi.mock('../lib/env.js', () => ({ env }))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const sdk = vi.hoisted(() => ({
  createStorageClient: vi.fn(() => ({ s3: true })),
  putObject: vi.fn(),
  deleteObject: vi.fn(),
  presignGet: vi.fn(),
}))
vi.mock('@apphub/platform-sdk/storage', () => sdk)

const inboundRepo = vi.hoisted(() => ({
  insertAttachment: vi.fn(async (_c, a) => ({ ...a, status: a.status ?? 'stored' })),
  findStoredBySha: vi.fn(),
}))
vi.mock('../repositories/inbound-emails.repository.js', () => inboundRepo)

const downloadAttachment = vi.hoisted(() => vi.fn())
vi.mock('../services/resend-inbound.service.js', () => ({ downloadAttachment }))

import * as svc from '../services/inbound-attachments.service.js'

const EMAIL = { id: 'e1', provider_email_id: 're_abc' }
const client = {}

beforeEach(() => {
  vi.clearAllMocks()
  svc.resetS3ClientCache()
  env.S3_ENDPOINT = 'http://minio:9000'
  env.S3_ACCESS_KEY = 'k'
  env.S3_SECRET_KEY = 's'
  inboundRepo.findStoredBySha.mockResolvedValue(null)
  downloadAttachment.mockResolvedValue(Buffer.from('PDFDATA'))
})

describe('attachmentPolicy', () => {
  it('defaults: 10MB + sensible content-type allowlist', () => {
    const p = svc.attachmentPolicy({})
    expect(p.maxBytes).toBe(10 * 1024 * 1024)
    expect(p.allowed).toContain('application/pdf')
  })
  it('config overrides', () => {
    const p = svc.attachmentPolicy({
      inbound_attachment_max_bytes: '1024',
      inbound_attachment_allowed_types: 'image/, application/pdf',
    })
    expect(p.maxBytes).toBe(1024)
    expect(p.allowed).toEqual(['image/', 'application/pdf'])
  })
})

describe('storeAttachments', () => {
  it('stores an allowed attachment in S3 under inbound/<emailId>/…', async () => {
    const out = await svc.storeAttachments(client, {
      email: EMAIL, apiKey: 're_k',
      attachments: [{ id: 'a1', filename: 'doc.pdf', contentType: 'application/pdf' }],
    })
    expect(sdk.putObject).toHaveBeenCalledWith({ s3: true }, expect.objectContaining({
      bucket: 'apphub',
      key: expect.stringMatching(/^inbound\/e1\/.+\/doc\.pdf$/),
      contentType: 'application/pdf',
    }))
    expect(out[0]).toMatchObject({ status: 'stored', sha256: expect.any(String) })
  })

  it('skips disallowed content-type without downloading', async () => {
    const out = await svc.storeAttachments(client, {
      email: EMAIL, apiKey: 're_k',
      attachments: [{ id: 'a1', filename: 'x.exe', contentType: 'application/x-msdownload' }],
    })
    expect(downloadAttachment).not.toHaveBeenCalled()
    expect(out[0]).toMatchObject({ status: 'skipped', skipReason: expect.stringContaining('not allowed') })
  })

  it('skips oversized payloads', async () => {
    downloadAttachment.mockResolvedValue(Buffer.alloc(2048))
    const out = await svc.storeAttachments(client, {
      email: EMAIL, apiKey: 're_k', cfg: { inbound_attachment_max_bytes: '1024' },
      attachments: [{ id: 'a1', filename: 'big.pdf', contentType: 'application/pdf' }],
    })
    expect(sdk.putObject).not.toHaveBeenCalled()
    expect(out[0]).toMatchObject({ status: 'skipped', skipReason: expect.stringContaining('too large') })
  })

  it('dedups identical bytes via sha256 (no second S3 write)', async () => {
    inboundRepo.findStoredBySha.mockResolvedValue({ bucket: 'apphub', object_key: 'inbound/e0/x/doc.pdf' })
    const out = await svc.storeAttachments(client, {
      email: EMAIL, apiKey: 're_k',
      attachments: [{ id: 'a1', filename: 'doc.pdf', contentType: 'application/pdf' }],
    })
    expect(sdk.putObject).not.toHaveBeenCalled()
    expect(out[0]).toMatchObject({ status: 'stored', objectKey: 'inbound/e0/x/doc.pdf' })
  })

  it('S3 unconfigured → metadata recorded as skipped (dev-stub)', async () => {
    env.S3_ENDPOINT = undefined
    svc.resetS3ClientCache()
    const out = await svc.storeAttachments(client, {
      email: EMAIL, apiKey: 're_k',
      attachments: [{ id: 'a1', filename: 'doc.pdf', contentType: 'application/pdf' }],
    })
    expect(out[0]).toMatchObject({ status: 'skipped', skipReason: 'storage_unconfigured' })
  })

  it('a failing download records status=failed and continues with the rest', async () => {
    downloadAttachment
      .mockRejectedValueOnce(new Error('expired url'))
      .mockResolvedValueOnce(Buffer.from('OK'))
    const out = await svc.storeAttachments(client, {
      email: EMAIL, apiKey: 're_k',
      attachments: [
        { id: 'a1', filename: 'rota.pdf', contentType: 'application/pdf' },
        { id: 'a2', filename: 'bien.pdf', contentType: 'application/pdf' },
      ],
    })
    expect(out[0]).toMatchObject({ status: 'failed' })
    expect(out[1]).toMatchObject({ status: 'stored' })
  })

  it('inline (inject) attachments bypass the provider download', async () => {
    const out = await svc.storeAttachments(client, {
      email: EMAIL, inline: true,
      attachments: [{ filename: 'n.txt', contentType: 'text/plain', contentBase64: Buffer.from('hola').toString('base64') }],
    })
    expect(downloadAttachment).not.toHaveBeenCalled()
    expect(out[0]).toMatchObject({ status: 'stored' })
  })
})

describe('deleteStoredObjects / attachmentDownloadUrl', () => {
  it('deletes each object best-effort and counts successes', async () => {
    sdk.deleteObject.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('nope'))
    const n = await svc.deleteStoredObjects([
      { bucket: 'apphub', object_key: 'k1' }, { bucket: 'apphub', object_key: 'k2' },
    ])
    expect(n).toBe(1)
  })
  it('returns 0 / null when S3 unconfigured', async () => {
    env.S3_ENDPOINT = undefined
    svc.resetS3ClientCache()
    expect(await svc.deleteStoredObjects([{ bucket: 'b', object_key: 'k' }])).toBe(0)
    expect(await svc.attachmentDownloadUrl({ object_key: 'k' })).toBe(null)
  })
  it('presigns a GET for stored attachments', async () => {
    sdk.presignGet.mockResolvedValue('https://signed')
    const url = await svc.attachmentDownloadUrl({ bucket: 'apphub', object_key: 'k' })
    expect(url).toBe('https://signed')
  })
})
