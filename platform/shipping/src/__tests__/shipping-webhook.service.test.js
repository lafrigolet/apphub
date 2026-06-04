// shipping.service — multi-package + carrier webhook ingest (idempotente,
// HMAC EasyPost, transición de estado downstream).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'node:crypto'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const poolClient = { query: vi.fn(), release: vi.fn() }
vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn(async () => poolClient) },
  withTenantTransaction: vi.fn(),
}))
vi.mock('../lib/redis.js', () => ({ publish: vi.fn() }))
vi.mock('../repositories/shipping.repository.js')
vi.mock('../repositories/settings.repository.js')

import * as service from '../services/shipping.service.js'
import { withTenantTransaction } from '../lib/db.js'
import * as repo from '../repositories/shipping.repository.js'
import * as configRepo from '../repositories/settings.repository.js'
import { NotFoundError } from '@apphub/platform-sdk/errors'

const APP = 'shop'
const TEN = 't1'
const ctx = { appId: APP, tenantId: TEN, subTenantId: null, userId: 'u1' }

function txClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  poolClient.query.mockReset().mockResolvedValue({ rows: [] })
  poolClient.release.mockReset()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(txClient()))
})

// ── multi-package ────────────────────────────────────────────────────────
describe('listPackages', () => {
  it('shipment inexistente → NotFoundError', async () => {
    repo.findShipmentById.mockResolvedValue(null)
    await expect(service.listPackages(ctx, 's1')).rejects.toThrow(NotFoundError)
  })
  it('happy → delega', async () => {
    repo.findShipmentById.mockResolvedValue({ id: 's1' })
    repo.listPackages.mockResolvedValue([{ id: 'p1' }])
    expect(await service.listPackages(ctx, 's1')).toEqual([{ id: 'p1' }])
  })
})

describe('addPackage', () => {
  it('shipment inexistente → NotFoundError', async () => {
    repo.findShipmentById.mockResolvedValue(null)
    await expect(service.addPackage(ctx, 's1', {})).rejects.toThrow(NotFoundError)
  })
  it('packageNumber omitido → auto-numerado + publica package.created', async () => {
    repo.findShipmentById.mockResolvedValue({ id: 's1' })
    repo.nextPackageNumber.mockResolvedValue(3)
    repo.insertPackage.mockResolvedValue({ id: 'p1' })
    await service.addPackage(ctx, 's1', { carrier: 'ups' })
    expect(repo.nextPackageNumber).toHaveBeenCalled()
    expect(repo.insertPackage).toHaveBeenCalledWith(expect.anything(), APP, TEN, 's1', expect.objectContaining({ packageNumber: 3 }))
  })
  it('packageNumber explícito → no llama nextPackageNumber', async () => {
    repo.findShipmentById.mockResolvedValue({ id: 's1' })
    repo.insertPackage.mockResolvedValue({ id: 'p1' })
    await service.addPackage(ctx, 's1', { packageNumber: 7 })
    expect(repo.nextPackageNumber).not.toHaveBeenCalled()
  })
})

// ── webhook ingest ──────────────────────────────────────────────────────
describe('ingestCarrierWebhook', () => {
  it('duplicado → { duplicate: true }', async () => {
    repo.insertWebhookEvent.mockResolvedValue(null) // ON CONFLICT suppressed
    const r = await service.ingestCarrierWebhook('ups', { rawBody: '{}', payload: {}, signatureHeader: undefined })
    expect(r).toEqual({ duplicate: true })
    expect(poolClient.release).toHaveBeenCalled()
  })

  it('fedex (Bearer, sin HMAC spec) → signatureValid null, persiste sin tracking', async () => {
    repo.insertWebhookEvent.mockResolvedValue({ id: 'w1' })
    repo.markWebhookProcessed.mockResolvedValue()
    const r = await service.ingestCarrierWebhook('fedex', { rawBody: '{}', payload: { id: 'ext1' }, signatureHeader: 'x' })
    expect(r).toEqual({ id: 'w1', signatureValid: null })
    expect(repo.markWebhookProcessed).toHaveBeenCalledWith(poolClient, 'w1')
  })

  it('ups HMAC-SHA256 firma válida → signatureValid true', async () => {
    const secret = 'ups-secret'
    const rawBody = JSON.stringify({ id: 'ups1' })
    const sig = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
    configRepo.getValue.mockResolvedValue(secret)
    repo.insertWebhookEvent.mockResolvedValue({ id: 'wups' })
    repo.markWebhookProcessed.mockResolvedValue()
    const r = await service.ingestCarrierWebhook('ups', { rawBody, payload: { id: 'ups1' }, signatureHeader: sig })
    expect(configRepo.getValue).toHaveBeenCalledWith(poolClient, 'ups_client_secret')
    expect(r.signatureValid).toBe(true)
  })

  it('dhl HMAC-SHA1 firma válida → signatureValid true', async () => {
    const secret = 'dhl-secret'
    const rawBody = JSON.stringify({ id: 'dhl1' })
    const sig = crypto.createHmac('sha1', secret).update(rawBody).digest('hex')
    configRepo.getValue.mockResolvedValue(secret)
    repo.insertWebhookEvent.mockResolvedValue({ id: 'wdhl' })
    repo.markWebhookProcessed.mockResolvedValue()
    const r = await service.ingestCarrierWebhook('dhl', { rawBody, payload: { id: 'dhl1' }, signatureHeader: sig })
    expect(configRepo.getValue).toHaveBeenCalledWith(poolClient, 'dhl_api_secret')
    expect(r.signatureValid).toBe(true)
  })

  it('dhl firma inválida → signatureValid false', async () => {
    configRepo.getValue.mockResolvedValue('dhl-secret')
    repo.insertWebhookEvent.mockResolvedValue({ id: 'wdhl2' })
    repo.markWebhookProcessed.mockResolvedValue()
    const r = await service.ingestCarrierWebhook('dhl', { rawBody: '{}', payload: {}, signatureHeader: 'deadbeef' })
    expect(r.signatureValid).toBe(false)
  })

  it('easypost firma válida → signatureValid true', async () => {
    const secret = 'topsecret'
    const rawBody = JSON.stringify({ id: 'ext2' })
    const sig = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
    configRepo.getValue.mockResolvedValue(secret)
    repo.insertWebhookEvent.mockResolvedValue({ id: 'w2' })
    repo.markWebhookProcessed.mockResolvedValue()
    const r = await service.ingestCarrierWebhook('easypost', {
      rawBody, payload: { id: 'ext2' }, signatureHeader: sig,
    })
    expect(r.signatureValid).toBe(true)
  })

  it('easypost firma inválida → signatureValid false', async () => {
    configRepo.getValue.mockResolvedValue('secret')
    repo.insertWebhookEvent.mockResolvedValue({ id: 'w3' })
    repo.markWebhookProcessed.mockResolvedValue()
    const r = await service.ingestCarrierWebhook('easypost', {
      rawBody: '{}', payload: {}, signatureHeader: 'deadbeef',
    })
    expect(r.signatureValid).toBe(false)
  })

  it('easypost sin secret configurado → verifyHmac early-return false (rama !secret)', async () => {
    configRepo.getValue.mockResolvedValue(null)   // sin secret → !secret true
    repo.insertWebhookEvent.mockResolvedValue({ id: 'w4' })
    repo.markWebhookProcessed.mockResolvedValue()
    const r = await service.ingestCarrierWebhook('easypost', {
      rawBody: '{}', payload: { id: 'ext4' }, signatureHeader: 'abc',
    })
    expect(r.signatureValid).toBe(false)
  })

  it('easypost sin signatureHeader → verifyHmac early-return false (rama !signatureHex)', async () => {
    configRepo.getValue.mockResolvedValue('secret')
    repo.insertWebhookEvent.mockResolvedValue({ id: 'w5' })
    repo.markWebhookProcessed.mockResolvedValue()
    const r = await service.ingestCarrierWebhook('easypost', {
      rawBody: '{}', payload: { id: 'ext5' }, signatureHeader: undefined,
    })
    expect(r.signatureValid).toBe(false)
  })

  it('tracking resuelto + status delivered → transición downstream', async () => {
    // tracking lookup query (poolClient) devuelve el paquete
    poolClient.query.mockResolvedValueOnce({
      rows: [{ app_id: APP, tenant_id: TEN, id: 'p1', shipment_id: 's1' }],
    })
    repo.insertWebhookEvent.mockResolvedValue({ id: 'w4' })
    repo.markWebhookProcessed.mockResolvedValue()
    repo.updateShipmentStatus.mockResolvedValue({ id: 's1' })
    repo.updatePackageStatus.mockResolvedValue({ id: 'p1' })
    repo.insertShipmentEvent.mockResolvedValue({ id: 'e1' })
    const r = await service.ingestCarrierWebhook('ups', {
      rawBody: '{}',
      payload: { id: 'ext4', tracking_code: 'TC1', status: 'delivered', message: 'arrived' },
      signatureHeader: undefined,
    })
    expect(r.id).toBe('w4')
    expect(repo.updateShipmentStatus).toHaveBeenCalled()
    expect(repo.updatePackageStatus).toHaveBeenCalled()
    expect(repo.insertShipmentEvent).toHaveBeenCalled()
  })

  it('tracking resuelto + in_transit con tracker.* anchors → shippedAt', async () => {
    poolClient.query.mockResolvedValueOnce({
      rows: [{ app_id: APP, tenant_id: TEN, id: 'p1', shipment_id: 's1' }],
    })
    repo.insertWebhookEvent.mockResolvedValue({ id: 'w5' })
    repo.markWebhookProcessed.mockResolvedValue()
    repo.updateShipmentStatus.mockResolvedValue({ id: 's1' })
    repo.updatePackageStatus.mockResolvedValue({ id: 'p1' })
    repo.insertShipmentEvent.mockResolvedValue({ id: 'e1' })
    await service.ingestCarrierWebhook('ups', {
      rawBody: '{}',
      payload: { event_id: 'ext5', tracker: { tracking_code: 'TC2' }, result: { status: 'in_transit' } },
      signatureHeader: undefined,
    })
    expect(repo.updateShipmentStatus).toHaveBeenCalledWith(
      expect.anything(), APP, TEN, 's1', 'in_transit', expect.objectContaining({ shippedAt: expect.any(Date) }),
    )
  })

  it('tracking no registrado → no transición, persiste con null ids', async () => {
    poolClient.query.mockResolvedValueOnce({ rows: [] }) // tracking lookup vacío
    repo.insertWebhookEvent.mockResolvedValue({ id: 'w6' })
    repo.markWebhookProcessed.mockResolvedValue()
    await service.ingestCarrierWebhook('ups', {
      rawBody: '{}', payload: { id: 'ext6', tracking_code: 'UNKNOWN', status: 'delivered' },
      signatureHeader: undefined,
    })
    expect(repo.updateShipmentStatus).not.toHaveBeenCalled()
    expect(repo.insertWebhookEvent).toHaveBeenCalledWith(poolClient, expect.objectContaining({ appId: null, tenantId: null }))
  })

  it('status no terminal → persiste pero sin transición', async () => {
    poolClient.query.mockResolvedValueOnce({
      rows: [{ app_id: APP, tenant_id: TEN, id: 'p1', shipment_id: 's1' }],
    })
    repo.insertWebhookEvent.mockResolvedValue({ id: 'w7' })
    repo.markWebhookProcessed.mockResolvedValue()
    await service.ingestCarrierWebhook('ups', {
      rawBody: '{}', payload: { id: 'ext7', tracking_code: 'TC3', status: 'pending' },
      signatureHeader: undefined,
    })
    expect(repo.updateShipmentStatus).not.toHaveBeenCalled()
  })

  it('downstream falla → swallow (logger.warn), aún marca procesado', async () => {
    poolClient.query.mockResolvedValueOnce({
      rows: [{ app_id: APP, tenant_id: TEN, id: 'p1', shipment_id: 's1' }],
    })
    repo.insertWebhookEvent.mockResolvedValue({ id: 'w8' })
    repo.markWebhookProcessed.mockResolvedValue()
    withTenantTransaction.mockRejectedValueOnce(new Error('db down'))
    const r = await service.ingestCarrierWebhook('ups', {
      rawBody: '{}', payload: { id: 'ext8', tracking_code: 'TC4', status: 'delivered' },
      signatureHeader: undefined,
    })
    expect(r.id).toBe('w8')
    expect(repo.markWebhookProcessed).toHaveBeenCalled()
  })

  it('delivered sin packageId (shipment sí, package null) → no updatePackageStatus', async () => {
    poolClient.query.mockResolvedValueOnce({
      rows: [{ app_id: APP, tenant_id: TEN, id: null, shipment_id: 's1' }],
    })
    repo.insertWebhookEvent.mockResolvedValue({ id: 'w9' })
    repo.markWebhookProcessed.mockResolvedValue()
    repo.updateShipmentStatus.mockResolvedValue({ id: 's1' })
    repo.insertShipmentEvent.mockResolvedValue({ id: 'e1' })
    await service.ingestCarrierWebhook('ups', {
      rawBody: '{}', payload: { id: 'ext9', tracking_code: 'TC5', status: 'returned' },
      signatureHeader: undefined,
    })
    expect(repo.updateShipmentStatus).toHaveBeenCalled()
    expect(repo.updatePackageStatus).not.toHaveBeenCalled()
  })
})
