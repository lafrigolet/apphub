// basket-abandoned.job — scanea Redis basket:* y publica basket.abandoned
// para los que están idle ≥24h.
// Contrato:
//   - SCAN cursor-based con MATCH 'basket:*' (no usa KEYS — blocking).
//   - Skip claves basket:abandoned-emitted:*  (las propias marker keys).
//   - Skip claves con split != 4 partes ('basket', appId, tenantId, userId).
//   - OBJECT IDLETIME < 24h → skip.
//   - basket sin items o JSON malformado → skip.
//   - SET marker `basket:abandoned-emitted:<sha1(key)>` con NX + EX 7d
//     suppression — si ya hay marker → skip (no respamea).
//   - Hidrata buyerEmail leyendo platform_auth.users (svc_platform_scheduler tiene BYPASSRLS).
//   - Errores en SELECT email → loguea warn pero NO bloquea publish.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as job from '../jobs/basket-abandoned.job.js'

const mkLogger = () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() })

function makeRedis({ keys = {}, idle = {}, markers = new Set() } = {}) {
  return {
    scan: vi.fn(async (_cursor, _match, _pat, _count, _n) => ['0', Object.keys(keys)]),
    object: vi.fn(async (_op, k) => idle[k] ?? null),
    get: vi.fn(async (k) => keys[k]),
    set: vi.fn(async (k, _v, _ex, _ttl, _nx) => {
      if (markers.has(k)) return null
      markers.add(k)
      return 'OK'
    }),
  }
}

beforeEach(() => vi.clearAllMocks())

// ── meta + scan setup ───────────────────────────────────────────────

describe('meta', () => {
  it('cron = "0 * * * *" (hourly)', () => {
    expect(job.meta.cron).toBe('0 * * * *')
  })
})

describe('SCAN setup', () => {
  it('usa SCAN con MATCH "basket:*" y COUNT 200, NO KEYS (blocking)', async () => {
    const redis = makeRedis()
    await job.run({ redis, publish: vi.fn(), logger: mkLogger() })
    expect(redis.scan).toHaveBeenCalledWith('0', 'MATCH', 'basket:*', 'COUNT', 200)
  })
})

// ── Filtros ──────────────────────────────────────────────────────────

describe('filtros', () => {
  it('skip claves marker propias (basket:abandoned-emitted:*)', async () => {
    const redis = makeRedis({
      keys: { 'basket:abandoned-emitted:sha': '1' },
      idle: { 'basket:abandoned-emitted:sha': 999999 },
    })
    const publish = vi.fn()
    await job.run({ redis, publish, logger: mkLogger() })
    expect(publish).not.toHaveBeenCalled()
  })

  it('skip claves con número de segmentos != 4 (corruptas)', async () => {
    const redis = makeRedis({
      keys: { 'basket:onlytwo': '{}' },
      idle: { 'basket:onlytwo': 999999 },
    })
    const publish = vi.fn()
    await job.run({ redis, publish, logger: mkLogger() })
    expect(publish).not.toHaveBeenCalled()
  })

  it('IDLETIME < 24h → skip', async () => {
    const k = 'basket:app:tenant:user'
    const redis = makeRedis({
      keys: { [k]: JSON.stringify({ items: [{ itemId: 'p1' }] }) },
      idle: { [k]: 60 * 60 },        // 1 hora
    })
    const publish = vi.fn()
    await job.run({ redis, publish, logger: mkLogger() })
    expect(publish).not.toHaveBeenCalled()
  })

  it('IDLETIME = null (clave volátil ya borrada) → skip', async () => {
    const k = 'basket:app:tenant:user'
    const redis = makeRedis({ keys: { [k]: '{}' }, idle: {} })
    const publish = vi.fn()
    await job.run({ redis, publish, logger: mkLogger() })
    expect(publish).not.toHaveBeenCalled()
  })

  it('basket sin items → skip', async () => {
    const k = 'basket:app:tenant:user'
    const redis = makeRedis({
      keys: { [k]: JSON.stringify({ items: [] }) },
      idle: { [k]: 99999 },
    })
    const publish = vi.fn()
    await job.run({ redis, publish, logger: mkLogger() })
    expect(publish).not.toHaveBeenCalled()
  })

  it('JSON malformado → skip sin crash', async () => {
    const k = 'basket:app:tenant:user'
    const redis = makeRedis({
      keys: { [k]: '{not json' },
      idle: { [k]: 99999 },
    })
    const publish = vi.fn()
    await expect(job.run({ redis, publish, logger: mkLogger() })).resolves.toBeDefined()
    expect(publish).not.toHaveBeenCalled()
  })
})

// ── Suppression (marker NX EX 7d) ───────────────────────────────────

describe('suppression marker', () => {
  it('happy: SET marker con NX + EX = 7*24*60*60', async () => {
    const k = 'basket:app:tenant:user'
    const redis = makeRedis({
      keys: { [k]: JSON.stringify({ items: [{ itemId: 'p1' }] }) },
      idle: { [k]: 99999 },
    })
    await job.run({ redis, publish: vi.fn(), logger: mkLogger() })
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^basket:abandoned-emitted:[a-f0-9]+$/),
      '1', 'EX', 7 * 24 * 60 * 60, 'NX',
    )
  })

  it('marker ya existe (SET retorna null) → NO publica', async () => {
    const k = 'basket:app:tenant:user'
    const markers = new Set([
      `basket:abandoned-emitted:${require('node:crypto').createHash('sha1').update(k).digest('hex')}`,
    ])
    const redis = makeRedis({
      keys: { [k]: JSON.stringify({ items: [{ itemId: 'p1' }] }) },
      idle: { [k]: 99999 },
      markers,
    })
    const publish = vi.fn()
    await job.run({ redis, publish, logger: mkLogger() })
    expect(publish).not.toHaveBeenCalled()
  })
})

// ── happy: publica basket.abandoned ─────────────────────────────────

describe('publish basket.abandoned', () => {
  it('payload incluye appId, tenantId, userId, buyerEmail, itemCount, idleSeconds, basketKey', async () => {
    const k = 'basket:demo-app:t-001:u-42'
    const redis = makeRedis({
      keys: { [k]: JSON.stringify({ items: [{ itemId: 'p1' }, { itemId: 'p2' }] }) },
      idle: { [k]: 90000 },
    })
    const db = { query: vi.fn().mockResolvedValue({ rows: [{ email: 'cart@example.com' }] }) }
    const publish = vi.fn()
    const r = await job.run({ redis, publish, logger: mkLogger(), db })

    expect(publish).toHaveBeenCalledWith({
      type: 'basket.abandoned',
      payload: {
        appId: 'demo-app', tenantId: 't-001', userId: 'u-42',
        buyerEmail: 'cart@example.com',
        itemCount: 2, idleSeconds: 90000,
        basketKey: k,
      },
    })
    expect(r.rowsAffected).toBe(1)
  })

  it('sin db → buyerEmail = null, no crash', async () => {
    const k = 'basket:demo-app:t-001:u-42'
    const redis = makeRedis({
      keys: { [k]: JSON.stringify({ items: [{ itemId: 'p1' }] }) },
      idle: { [k]: 90000 },
    })
    const publish = vi.fn()
    await job.run({ redis, publish, logger: mkLogger() })   // db undefined
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ buyerEmail: null }),
    }))
  })

  it('lookup email falla → warn + publish con buyerEmail=null', async () => {
    const k = 'basket:demo-app:t-001:u-42'
    const redis = makeRedis({
      keys: { [k]: JSON.stringify({ items: [{ itemId: 'p1' }] }) },
      idle: { [k]: 90000 },
    })
    const db = { query: vi.fn().mockRejectedValue(new Error('grant missing')) }
    const publish = vi.fn()
    const logger = mkLogger()
    await job.run({ redis, publish, logger, db })
    expect(logger.warn).toHaveBeenCalled()
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ buyerEmail: null }),
    }))
  })

  it('0 baskets idle → 0 publish, no log.info', async () => {
    const redis = makeRedis()
    const publish = vi.fn()
    const logger = mkLogger()
    await job.run({ redis, publish, logger })
    expect(publish).not.toHaveBeenCalled()
    expect(logger.info).not.toHaveBeenCalled()
  })
})
