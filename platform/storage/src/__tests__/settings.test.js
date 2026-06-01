// lib/settings — merge de config S3 (DB sobre env). loadSettings cachea;
// invalidate() fuerza re-lectura. getSettings() cae a env si no hay cache.
// Cubre el override DB→env por campo y el parsing de forcePathStyle.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    S3_ENDPOINT: 'http://minio:9000',
    S3_PUBLIC_ENDPOINT: 'http://localhost:9000',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'apphub',
    S3_ACCESS_KEY: 'envkey',
    S3_SECRET_KEY: 'envsecret',
    S3_FORCE_PATH_STYLE: true,
  },
}))

const { release, connect, getAll } = vi.hoisted(() => {
  const release = vi.fn()
  return { release, connect: vi.fn(async () => ({ release })), getAll: vi.fn() }
})
vi.mock('../lib/db.js', () => ({ pool: { connect } }))
vi.mock('../repositories/settings.repository.js', () => ({ getAll: (...a) => getAll(...a) }))

import { loadSettings, getSettings, invalidate } from '../lib/settings.js'

beforeEach(() => {
  vi.clearAllMocks()
  invalidate()
})

describe('getSettings (sin cache)', () => {
  it('cae a env cuando loadSettings no se ha llamado', () => {
    const s = getSettings()
    expect(s).toEqual({
      endpoint: 'http://minio:9000',
      publicEndpoint: 'http://localhost:9000',
      region: 'us-east-1',
      bucket: 'apphub',
      accessKey: 'envkey',
      secretKey: 'envsecret',
      forcePathStyle: true,
    })
  })
})

describe('loadSettings', () => {
  it('DB vacía → todos los valores de env; libera el client', async () => {
    getAll.mockResolvedValue({})
    const s = await loadSettings()
    expect(s.endpoint).toBe('http://minio:9000')
    expect(s.bucket).toBe('apphub')
    expect(s.forcePathStyle).toBe(true) // env fallback (DB ausente)
    expect(release).toHaveBeenCalled()
    // cacheado: getSettings devuelve lo mismo
    expect(getSettings()).toEqual(s)
  })

  it('DB sobrescribe env campo a campo', async () => {
    getAll.mockResolvedValue({
      s3_endpoint: 'http://db-endpoint:9000',
      s3_region: 'eu-west-1',
      s3_bucket: 'dbbucket',
      s3_access_key: 'dbkey',
      s3_secret_key: 'dbsecret',
    })
    const s = await loadSettings()
    expect(s.endpoint).toBe('http://db-endpoint:9000')
    expect(s.region).toBe('eu-west-1')
    expect(s.bucket).toBe('dbbucket')
    expect(s.accessKey).toBe('dbkey')
    expect(s.secretKey).toBe('dbsecret')
    // publicEndpoint no estaba en DB → cae a env
    expect(s.publicEndpoint).toBe('http://localhost:9000')
  })

  it('forcePathStyle desde DB "true" → boolean true', async () => {
    getAll.mockResolvedValue({ s3_force_path_style: 'true' })
    const s = await loadSettings()
    expect(s.forcePathStyle).toBe(true)
  })

  it('forcePathStyle desde DB "false" → boolean false', async () => {
    getAll.mockResolvedValue({ s3_force_path_style: 'false' })
    const s = await loadSettings()
    expect(s.forcePathStyle).toBe(false)
  })

  it('libera el client incluso si getAll lanza', async () => {
    getAll.mockRejectedValue(new Error('boom'))
    await expect(loadSettings()).rejects.toThrow('boom')
    expect(release).toHaveBeenCalled()
  })
})

describe('invalidate', () => {
  it('tras invalidar, getSettings vuelve a env', async () => {
    getAll.mockResolvedValue({ s3_bucket: 'dbbucket' })
    await loadSettings()
    expect(getSettings().bucket).toBe('dbbucket')
    invalidate()
    expect(getSettings().bucket).toBe('apphub') // env fallback
  })
})
