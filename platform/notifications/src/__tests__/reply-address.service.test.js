// reply-address.service — mints reply+<token>@<inbound_domain> addresses or
// returns null (inbound off / no domain / failure). Never throws to callers.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { release, connect } = vi.hoisted(() => ({ release: vi.fn(), connect: vi.fn() }))
vi.mock('../lib/db.js', () => ({ pool: { connect } }))

const tokensRepo = vi.hoisted(() => ({ insert: vi.fn() }))
vi.mock('../repositories/inbound-reply-tokens.repository.js', () => tokensRepo)

const getInboundConfig = vi.hoisted(() => vi.fn())
vi.mock('../services/inbound-config.service.js', () => ({
  getInboundConfig,
  isInboundEnabled: (cfg) => String(cfg?.inbound_enabled ?? '').toLowerCase() === 'true',
}))

import { mintReplyAddress } from '../services/reply-address.service.js'

beforeEach(() => {
  vi.clearAllMocks()
  connect.mockResolvedValue({ release })
})

describe('mintReplyAddress', () => {
  it('mints reply+<hex>@domain and persists the token with context', async () => {
    getInboundConfig.mockResolvedValue({ inbound_enabled: 'true', inbound_domain: 'reply.h.com' })
    const addr = await mintReplyAddress({
      targetEvent: 'inquiry.reply.received',
      context: { inquiryId: 'i1' }, appId: 'aikikan', tenantId: 't1',
    })
    expect(addr).toMatch(/^reply\+[0-9a-f]{20}@reply\.h\.com$/)
    expect(tokensRepo.insert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      targetEvent: 'inquiry.reply.received',
      context: { inquiryId: 'i1' },
      appId: 'aikikan', tenantId: 't1',
      expiresAt: expect.any(Date),
    }))
  })
  it('null when inbound disabled or domain missing', async () => {
    getInboundConfig.mockResolvedValue({ inbound_enabled: 'false', inbound_domain: 'reply.h.com' })
    expect(await mintReplyAddress({ targetEvent: 'x' })).toBe(null)
    getInboundConfig.mockResolvedValue({ inbound_enabled: 'true' })
    expect(await mintReplyAddress({ targetEvent: 'x' })).toBe(null)
    expect(tokensRepo.insert).not.toHaveBeenCalled()
  })
  it('null (not throw) when persistence fails — send must not be blocked', async () => {
    getInboundConfig.mockResolvedValue({ inbound_enabled: 'true', inbound_domain: 'reply.h.com' })
    tokensRepo.insert.mockRejectedValue(new Error('db down'))
    expect(await mintReplyAddress({ targetEvent: 'x' })).toBe(null)
  })
})
