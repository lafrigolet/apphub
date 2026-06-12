// EasyPost thin client — credential loading, stub mode, auth header, and the
// 4xx→422 / 5xx→502 error mapping. Network is stubbed via global fetch.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const fakeClient = { release: vi.fn() }
vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn(async () => fakeClient) },
}))

const getValue = vi.fn()
vi.mock('../repositories/settings.repository.js', () => ({ getValue: (...a) => getValue(...a) }))

import {
  reloadEasyPostFromDb, isStubbed, resetEasyPostClient,
  verifyAddress, createShipment, EasyPostError, EasyPostNotConfiguredError,
} from '../lib/easypost.js'

beforeEach(() => {
  vi.clearAllMocks()
  resetEasyPostClient()
})

async function configure({ key = 'EZTK_test', enabled = 'true' } = {}) {
  getValue.mockImplementation(async (_c, k) => (k === 'easypost_enabled' ? enabled : k === 'easypost_api_key' ? key : null))
  await reloadEasyPostFromDb()
}

describe('credential loading + stub mode', () => {
  it('stubbed before configuration', () => {
    expect(isStubbed()).toBe(true)
  })

  it('not stubbed once key + enabled are set', async () => {
    await configure()
    expect(isStubbed()).toBe(false)
  })

  it('stays stubbed when disabled even with a key', async () => {
    await configure({ enabled: 'false' })
    expect(isStubbed()).toBe(true)
  })

  it('outbound call throws EasyPostNotConfiguredError (503) while stubbed', async () => {
    await expect(verifyAddress({ street1: 'x', city: 'y', country: 'US' }))
      .rejects.toBeInstanceOf(EasyPostNotConfiguredError)
  })
})

describe('auth + error mapping', () => {
  it('sends HTTP Basic auth with the api key as username', async () => {
    await configure({ key: 'EZTK_abc' })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'adr_1' }), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    await verifyAddress({ street1: '1 A St', city: 'NYC', country: 'US' })
    const [, opts] = fetchMock.mock.calls[0]
    expect(opts.headers.Authorization).toBe('Basic ' + Buffer.from('EZTK_abc:').toString('base64'))
    vi.unstubAllGlobals()
  })

  it('4xx → EasyPostError 422 with the carrier message', async () => {
    await configure()
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: 'invalid address' } }), { status: 422 })))
    await expect(createShipment({ toAddress: {}, fromAddress: {}, parcel: { weight: 10 } }))
      .rejects.toMatchObject({ name: 'EasyPostError', statusCode: 422, message: 'invalid address' })
    vi.unstubAllGlobals()
  })

  it('5xx → EasyPostError 502', async () => {
    await configure()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('upstream boom', { status: 503 })))
    await expect(createShipment({ toAddress: {}, fromAddress: {}, parcel: { weight: 10 } }))
      .rejects.toMatchObject({ name: 'EasyPostError', statusCode: 502 })
    vi.unstubAllGlobals()
  })
})
