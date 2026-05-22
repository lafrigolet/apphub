// videos.service — catálogo de videos vinculados a YouTube IDs.
// Contrato:
//   - listVideos: tenantId vacío → ValidationError 422.
//   - createVideo: requiere owner/admin (else 403); persiste con position auto-asignado.
//   - deleteVideo: requiere owner/admin; row no existe → NotFoundError.
//
// Nota — la validación de formato del YouTube ID NO existe a nivel de
// service (es responsabilidad del schema route + UI). Este test
// documenta ese límite: cualquier string se acepta. Si en el futuro
// se añade un check (e.g. 11 chars [A-Za-z0-9_-]), el test marcado
// `.todo` se debe convertir en un check estricto.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    NODE_ENV: 'test', LOG_LEVEL: 'error',
    DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost',
    PLATFORM_JWT_SECRET: 'test-secret-32-chars-xxxxxxxxxxxxxxx',
  },
}))
vi.mock('../lib/db.js', () => ({ pool: {}, withTenantTransaction: vi.fn() }))
vi.mock('../repositories/videos.repository.js')

import { listVideos, createVideo, deleteVideo } from '../services/videos.service.js'
import { withTenantTransaction } from '../lib/db.js'
import * as repo from '../repositories/videos.repository.js'

const APP    = 'aikikan'
const TENANT = '22222222-2222-2222-2222-222222222222'

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn({}))
})

// ── listVideos ──────────────────────────────────────────────────────

describe('listVideos', () => {
  it('tenantId vacío → ValidationError 422', async () => {
    await expect(listVideos(null)).rejects.toMatchObject({ statusCode: 422 })
    await expect(listVideos('')).rejects.toMatchObject({ statusCode: 422 })
  })

  it('happy: APP_ID hardcoded a "aikikan"', async () => {
    repo.findAll.mockResolvedValue([{ id: 'v1' }])
    await listVideos(TENANT)
    expect(withTenantTransaction).toHaveBeenCalledWith(
      expect.anything(), APP, TENANT, null, expect.any(Function),
    )
  })
})

// ── createVideo — role guard + persistencia ─────────────────────────

describe('createVideo — guards', () => {
  it.each([['user'], ['member'], ['staff'], [null], [undefined]])(
    'rol "%s" → ForbiddenError 403',
    async (role) => {
      await expect(createVideo(
        { userId: 'u1', appId: APP, tenantId: TENANT, role },
        { youtubeId: 'dQw4w9WgXcQ', name: 'Test' },
      )).rejects.toMatchObject({ statusCode: 403 })
      expect(repo.insert).not.toHaveBeenCalled()
    },
  )

  it.each([['owner'], ['admin']])('rol "%s" → permitido', async (role) => {
    repo.insert.mockResolvedValue({ id: 'v1', youtube_id: 'dQw4w9WgXcQ' })
    await createVideo(
      { userId: 'a1', appId: APP, tenantId: TENANT, role },
      { youtubeId: 'dQw4w9WgXcQ', label: 'Kata', name: 'Saburi 1' },
    )
    expect(repo.insert).toHaveBeenCalledWith(expect.anything(), {
      appId: APP, tenantId: TENANT, subTenantId: null,
      youtubeId: 'dQw4w9WgXcQ', label: 'Kata', name: 'Saburi 1',
    })
  })

  it('label opcional → undefined propagado', async () => {
    repo.insert.mockResolvedValue({ id: 'v1' })
    await createVideo(
      { userId: 'a1', appId: APP, tenantId: TENANT, role: 'admin' },
      { youtubeId: 'abc', name: 'Solo' },
    )
    const args = repo.insert.mock.calls[0][1]
    expect(args.label).toBeUndefined()
  })

  it('identity sin userId → 403', async () => {
    await expect(createVideo({ role: 'admin' }, { youtubeId: 'x', name: 'y' }))
      .rejects.toMatchObject({ statusCode: 403 })
  })
})

// ── deleteVideo ─────────────────────────────────────────────────────

describe('deleteVideo', () => {
  it('rol "user" → ForbiddenError', async () => {
    await expect(deleteVideo({ userId: 'u1', appId: APP, tenantId: TENANT, role: 'user' }, 'v1'))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('video no existe → NotFoundError 404', async () => {
    repo.deleteById.mockResolvedValue(false)
    await expect(deleteVideo({ userId: 'a1', appId: APP, tenantId: TENANT, role: 'admin' }, 'ghost'))
      .rejects.toMatchObject({ statusCode: 404 })
  })

  it('happy: admin borra existente → undefined', async () => {
    repo.deleteById.mockResolvedValue(true)
    await expect(deleteVideo({ userId: 'a1', appId: APP, tenantId: TENANT, role: 'owner' }, 'v1'))
      .resolves.toBeUndefined()
  })
})

// ── YouTube ID — comportamiento actual (sin validación) ─────────────

describe('YouTube ID validation', () => {
  it('acepta cualquier string como youtubeId (NO hay validation a nivel service)', async () => {
    repo.insert.mockResolvedValue({ id: 'v1' })
    await createVideo(
      { userId: 'a1', appId: APP, tenantId: TENANT, role: 'admin' },
      { youtubeId: 'NOT-A-VALID-YT-ID-12345', name: 'X' },
    )
    expect(repo.insert).toHaveBeenCalled()
  })

  it.todo('rechazar youtubeId con formato inválido (no 11 chars [A-Za-z0-9_-])')
})
