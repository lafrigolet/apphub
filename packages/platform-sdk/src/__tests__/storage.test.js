// platform-sdk/storage — helpers para S3-compatible presigned URLs.
// Contrato:
//   - createStorageClient:
//       · Args obligatorios: endpoint, region, accessKey, secretKey.
//       · Falta cualquiera → Error explícito.
//       · forcePathStyle=true por default (necesario para MinIO).
//       · Configura credentials = { accessKeyId, secretAccessKey }.
//   - presignPut: PutObjectCommand con Bucket/Key/ContentType/ContentLength + ttlSeconds default 600.
//   - presignGet: GetObjectCommand + ttlSeconds default 300.
//   - headObject/deleteObject: invoke client.send con Head/Delete command.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { s3ClientMock, sendMock, getSignedUrlMock } = vi.hoisted(() => ({
  s3ClientMock: vi.fn(),
  sendMock: vi.fn().mockResolvedValue({ ContentLength: 100, ETag: '"abc"' }),
  getSignedUrlMock: vi.fn().mockResolvedValue('https://signed.url/path?sig=xxx'),
}))

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: s3ClientMock.mockImplementation(function (opts) {
    this.config = opts
    this.send   = sendMock
  }),
  PutObjectCommand:    vi.fn().mockImplementation((args) => ({ __cmd: 'Put', args })),
  GetObjectCommand:    vi.fn().mockImplementation((args) => ({ __cmd: 'Get', args })),
  HeadObjectCommand:   vi.fn().mockImplementation((args) => ({ __cmd: 'Head', args })),
  DeleteObjectCommand: vi.fn().mockImplementation((args) => ({ __cmd: 'Delete', args })),
}))

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: getSignedUrlMock,
}))

import {
  createStorageClient, presignPut, presignGet, headObject, deleteObject,
} from '../storage.js'

beforeEach(() => {
  vi.clearAllMocks()
  sendMock.mockResolvedValue({ ContentLength: 100, ETag: '"abc"' })
  getSignedUrlMock.mockResolvedValue('https://signed.url/path?sig=xxx')
})

// ── createStorageClient — validations ────────────────────────────────

describe('createStorageClient — validations', () => {
  const valid = {
    endpoint: 'http://minio:9000',
    region: 'us-east-1',
    accessKey: 'a',
    secretKey: 'b',
  }

  it('happy: configura S3Client con endpoint, region, credentials, forcePathStyle=true', () => {
    createStorageClient(valid)
    expect(s3ClientMock).toHaveBeenCalledWith({
      endpoint: 'http://minio:9000',
      region: 'us-east-1',
      credentials: { accessKeyId: 'a', secretAccessKey: 'b' },
      forcePathStyle: true,
    })
  })

  it('forcePathStyle override → false (para AWS S3 standard)', () => {
    createStorageClient({ ...valid, forcePathStyle: false })
    expect(s3ClientMock).toHaveBeenCalledWith(expect.objectContaining({ forcePathStyle: false }))
  })

  it.each([['endpoint'], ['region']])('falta %s → Error', (field) => {
    const opts = { ...valid }; delete opts[field]
    expect(() => createStorageClient(opts)).toThrow(new RegExp(`${field}.*required`, 'i'))
  })

  it('falta accessKey → Error genérico "accessKey/secretKey are required"', () => {
    expect(() => createStorageClient({ ...valid, accessKey: undefined }))
      .toThrow(/accessKey\/secretKey are required/)
  })

  it('falta secretKey → Error genérico "accessKey/secretKey are required"', () => {
    expect(() => createStorageClient({ ...valid, secretKey: undefined }))
      .toThrow(/accessKey\/secretKey are required/)
  })
})

// ── presignPut ──────────────────────────────────────────────────────

describe('presignPut', () => {
  it('PutObjectCommand con Bucket/Key/ContentType/ContentLength + TTL default 600s', async () => {
    const client = createStorageClient({ endpoint: 'http://x', region: 'r', accessKey: 'a', secretKey: 'b' })
    const url = await presignPut(client, {
      bucket: 'test-b', key: 'a/b/c', contentType: 'image/png', contentLength: 1024,
    })
    expect(url).toBe('https://signed.url/path?sig=xxx')
    expect(getSignedUrlMock).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        __cmd: 'Put',
        args: { Bucket: 'test-b', Key: 'a/b/c', ContentType: 'image/png', ContentLength: 1024 },
      }),
      { expiresIn: 600 },
    )
  })

  it('TTL override propaga a getSignedUrl', async () => {
    const client = createStorageClient({ endpoint: 'http://x', region: 'r', accessKey: 'a', secretKey: 'b' })
    await presignPut(client, { bucket: 'b', key: 'k', contentType: 'a/b', contentLength: 1, ttlSeconds: 3600 })
    expect(getSignedUrlMock).toHaveBeenCalledWith(
      client, expect.anything(), { expiresIn: 3600 },
    )
  })
})

// ── presignGet ──────────────────────────────────────────────────────

describe('presignGet', () => {
  it('GetObjectCommand + TTL default 300s', async () => {
    const client = createStorageClient({ endpoint: 'http://x', region: 'r', accessKey: 'a', secretKey: 'b' })
    await presignGet(client, { bucket: 'b', key: 'k' })
    expect(getSignedUrlMock).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ __cmd: 'Get', args: { Bucket: 'b', Key: 'k' } }),
      { expiresIn: 300 },
    )
  })

  it('TTL override = 60s', async () => {
    const client = createStorageClient({ endpoint: 'http://x', region: 'r', accessKey: 'a', secretKey: 'b' })
    await presignGet(client, { bucket: 'b', key: 'k', ttlSeconds: 60 })
    expect(getSignedUrlMock).toHaveBeenCalledWith(client, expect.anything(), { expiresIn: 60 })
  })
})

// ── headObject + deleteObject ───────────────────────────────────────

describe('headObject', () => {
  it('envía HeadObjectCommand al client y devuelve metadata', async () => {
    const client = createStorageClient({ endpoint: 'http://x', region: 'r', accessKey: 'a', secretKey: 'b' })
    const r = await headObject(client, { bucket: 'b', key: 'k' })
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ __cmd: 'Head', args: { Bucket: 'b', Key: 'k' } }))
    expect(r.ContentLength).toBe(100)
  })

  it('propaga errores S3 (404, 403, etc.)', async () => {
    const client = createStorageClient({ endpoint: 'http://x', region: 'r', accessKey: 'a', secretKey: 'b' })
    sendMock.mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 }, name: 'NotFound' })
    await expect(headObject(client, { bucket: 'b', key: 'ghost' })).rejects.toMatchObject({
      $metadata: { httpStatusCode: 404 },
    })
  })
})

describe('deleteObject', () => {
  it('envía DeleteObjectCommand al client', async () => {
    const client = createStorageClient({ endpoint: 'http://x', region: 'r', accessKey: 'a', secretKey: 'b' })
    await deleteObject(client, { bucket: 'b', key: 'k' })
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ __cmd: 'Delete', args: { Bucket: 'b', Key: 'k' } }))
  })
})
