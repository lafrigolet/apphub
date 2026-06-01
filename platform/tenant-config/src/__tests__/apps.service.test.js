// apps.service — registro plataforma de apps (CRUD).
// Contrato:
//   - listApps: pasa client a appsRepo.findAll.
//   - getApp(appId): 404 si no existe.
//   - createApp:
//       · Pg unique violation (code 23505) → ConflictError 409.
//       · Falla de writeAppNginxConfig NO revierte: la app queda persistida,
//         se loguea un warn — el operador puede re-disparar después.
//   - setAppStatus / setAppSplitpayEnabled / setAppEnabledModules:
//       · 404 si el repo devuelve null (no rows updated).
//       · Devuelve el row actualizado al caller.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    NODE_ENV: 'test', LOG_LEVEL: 'error',
    DATABASE_URL_TENANTS: 'postgresql://x@y/z',
    REDIS_URL: 'redis://localhost',
  },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({
  pool: {},
  withTransaction: vi.fn(),
}))
vi.mock('../services/nginx-config.service.js', () => ({
  writeAppNginxConfig: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../repositories/apps.repository.js')

import {
  listApps, getApp, createApp, setAppStatus, setAppSplitpayEnabled, setAppEnabledModules,
} from '../services/apps.service.js'
import { withTransaction } from '../lib/db.js'
import { writeAppNginxConfig } from '../services/nginx-config.service.js'
import * as repo from '../repositories/apps.repository.js'
import { logger } from '../lib/logger.js'

beforeEach(() => {
  vi.clearAllMocks()
  withTransaction.mockImplementation(async (_p, fn) => fn({}))
})

// ── listApps / getApp ────────────────────────────────────────────────

describe('listApps', () => {
  it('retorna todas las apps', async () => {
    repo.findAll.mockResolvedValue([{ app_id: 'aikikan' }, { app_id: 'consola' }])
    const r = await listApps()
    expect(r).toHaveLength(2)
  })
})

describe('getApp', () => {
  it('happy: retorna app', async () => {
    repo.findByAppId.mockResolvedValue({ app_id: 'aikikan' })
    const r = await getApp('aikikan')
    expect(r.app_id).toBe('aikikan')
  })
  it('appId no existe → NotFoundError 404', async () => {
    repo.findByAppId.mockResolvedValue(null)
    await expect(getApp('ghost')).rejects.toMatchObject({ statusCode: 404 })
  })
})

// ── createApp ────────────────────────────────────────────────────────

describe('createApp', () => {
  it('happy: persiste + dispara nginx config + retorna row', async () => {
    repo.create.mockResolvedValue({
      app_id: 'new', subdomain: 'new', display_name: 'New', jwt_audience: 'aud', splitpay_enabled: false,
    })
    const r = await createApp({
      appId: 'new', displayName: 'New', subdomain: 'new', jwtAudience: 'aud', splitpayEnabled: false,
    })
    expect(r.app_id).toBe('new')
    expect(writeAppNginxConfig).toHaveBeenCalledWith({ appId: 'new', subdomain: 'new' })
  })

  it('unique violation Postgres (23505) → ConflictError 409', async () => {
    const err = new Error('duplicate key value')
    err.code = '23505'
    repo.create.mockRejectedValue(err)
    await expect(createApp({
      appId: 'aikikan', displayName: 'X', subdomain: 'aikikan', jwtAudience: 'aud', splitpayEnabled: false,
    })).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('already exists') })
    expect(writeAppNginxConfig).not.toHaveBeenCalled()
  })

  it('otros errores DB → propagan (no 409)', async () => {
    repo.create.mockRejectedValue(new Error('connection refused'))
    await expect(createApp({
      appId: 'x', displayName: 'X', subdomain: 'x', jwtAudience: 'aud', splitpayEnabled: false,
    })).rejects.toThrow('connection refused')
  })

  it('si nginx publish falla → app YA persistida + warn (no se revierte)', async () => {
    repo.create.mockResolvedValue({ app_id: 'new', subdomain: 'new' })
    writeAppNginxConfig.mockRejectedValueOnce(new Error('redis down'))
    const r = await createApp({
      appId: 'new', displayName: 'New', subdomain: 'new', jwtAudience: 'aud',
    })
    expect(r.app_id).toBe('new')                          // app SÍ persiste
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'new' }),
      expect.stringContaining('Failed to publish NGINX'),
    )
  })
})

// ── setters: 404 cuando appId no existe ─────────────────────────────

describe('setAppStatus', () => {
  it('happy: retorna row', async () => {
    repo.updateStatus.mockResolvedValue({ app_id: 'aikikan', status: 'suspended' })
    const r = await setAppStatus('aikikan', 'suspended')
    expect(r.status).toBe('suspended')
  })
  it('null → NotFoundError 404', async () => {
    repo.updateStatus.mockResolvedValue(null)
    await expect(setAppStatus('ghost', 'active')).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('setAppSplitpayEnabled', () => {
  it('happy: retorna la app actualizada', async () => {
    repo.updateSplitpayEnabled.mockResolvedValue({ app_id: 'aikikan', splitpay_enabled: true })
    const r = await setAppSplitpayEnabled('aikikan', true)
    expect(r.splitpay_enabled).toBe(true)
  })
  it('null → NotFoundError 404', async () => {
    repo.updateSplitpayEnabled.mockResolvedValue(null)
    await expect(setAppSplitpayEnabled('ghost', true)).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('setAppEnabledModules', () => {
  it('happy: retorna row con nuevos módulos', async () => {
    repo.updateEnabledModules.mockResolvedValue({ app_id: 'aikikan', enabled_modules: ['leads', 'donations'] })
    const r = await setAppEnabledModules('aikikan', ['leads', 'donations'])
    expect(r.enabled_modules).toEqual(['leads', 'donations'])
    expect(repo.updateEnabledModules).toHaveBeenCalledWith({}, 'aikikan', ['leads', 'donations'])
  })
  it('null → NotFoundError 404', async () => {
    repo.updateEnabledModules.mockResolvedValue(null)
    await expect(setAppEnabledModules('ghost', [])).rejects.toMatchObject({ statusCode: 404 })
  })
})
