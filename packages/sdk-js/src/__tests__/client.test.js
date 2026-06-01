// @splitpay/sdk-js client (3.2 · P1) — el cliente tipado que usan los
// frontends. Contrato del helper fetch interno:
//   - prefija baseUrl + path.
//   - resuelve getToken() (sync o async) y lo manda como `Authorization: Bearer`.
//   - Content-Type: application/json siempre.
//   - desempaqueta `json.data`; en !res.ok lanza Error con `json.error.message`.
//   - cada método compone método HTTP + path + body correctos.
// (No hay retry built-in — el SDK delega reintentos al caller; no se testea.)
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSplitPayClient } from '../index.ts'

function mockFetch(response) {
  const fn = vi.fn(async () => ({
    ok: response.ok ?? true,
    json: async () => response.body ?? {},
  }))
  global.fetch = fn
  return fn
}

const BASE = 'http://api.test'
let getToken
beforeEach(() => { getToken = vi.fn(async () => 'tok-123') })

function client(extra = {}) {
  return createSplitPayClient({ baseUrl: BASE, getToken, ...extra })
}

describe('fetch helper — auth + base url + unwrap', () => {
  it('GET split-rules: baseUrl+path, Authorization Bearer, Content-Type json; devuelve json.data', async () => {
    const fetchMock = mockFetch({ body: { data: [{ id: 'sr1' }] } })
    const out = await client().splitRules.list()
    expect(out).toEqual([{ id: 'sr1' }])
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${BASE}/split-rules`)
    expect(init.headers.Authorization).toBe('Bearer tok-123')
    expect(init.headers['Content-Type']).toBe('application/json')
  })

  it('getToken async se await-ea antes de armar el header', async () => {
    const fetchMock = mockFetch({ body: { data: [] } })
    getToken = vi.fn(() => Promise.resolve('async-tok'))
    await client().splitRules.list()
    expect(getToken).toHaveBeenCalled()
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer async-tok')
  })

  it('!res.ok → lanza Error con el message del error del backend', async () => {
    mockFetch({ ok: false, body: { error: { code: 'NOT_FOUND', message: 'no existe' } } })
    await expect(client().splitRules.get('x')).rejects.toThrow('no existe')
  })

  it('!res.ok sin error.message → "Request failed"', async () => {
    mockFetch({ ok: false, body: {} })
    await expect(client().splitRules.get('x')).rejects.toThrow('Request failed')
  })
})

describe('splitRules', () => {
  it('create → POST /split-rules con body serializado', async () => {
    const fetchMock = mockFetch({ body: { data: { id: 'sr1' } } })
    const body = { name: 'R', platformFeePercent: 5, recipients: [] }
    await client().splitRules.create(body)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${BASE}/split-rules`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual(body)
  })

  it('deactivate → DELETE /split-rules/:id', async () => {
    const fetchMock = mockFetch({ body: { data: null } })
    await client().splitRules.deactivate('sr9')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${BASE}/split-rules/sr9`)
    expect(init.method).toBe('DELETE')
  })

  it('simulate → POST /split-rules/simulate con {splitRuleId, amount, currency}', async () => {
    const fetchMock = mockFetch({ body: { data: { netAmount: 95 } } })
    await client().splitRules.simulate('sr1', 1000, 'eur')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${BASE}/split-rules/simulate`)
    expect(JSON.parse(init.body)).toEqual({ splitRuleId: 'sr1', amount: 1000, currency: 'eur' })
  })
})

describe('payments', () => {
  it('create → POST /payments con idempotencyKey en el body', async () => {
    const fetchMock = mockFetch({ body: { data: { clientSecret: 'cs', paymentId: 'p1' } } })
    const body = { amount: 1000, currency: 'eur', splitRuleId: 'sr1', merchantAccountId: 'm1', idempotencyKey: 'idem-1' }
    const out = await client().payments.create(body)
    expect(out).toEqual({ clientSecret: 'cs', paymentId: 'p1' })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).idempotencyKey).toBe('idem-1')
  })

  it('list sin params → GET /payments (sin querystring)', async () => {
    const fetchMock = mockFetch({ body: { data: { data: [], cursor: null, hasMore: false } } })
    await client().payments.list()
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/payments`)
  })

  it('list con params → querystring serializado', async () => {
    const fetchMock = mockFetch({ body: { data: { data: [], cursor: null, hasMore: false } } })
    await client().payments.list({ limit: 10, cursor: 'abc' })
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/payments?limit=10&cursor=abc`)
  })

  it('refund → POST /payments/:id/refunds con idempotencyKey', async () => {
    const fetchMock = mockFetch({ body: { data: { refundId: 'r1' } } })
    await client().payments.refund('p1', { amount: 500, idempotencyKey: 'idem-r' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${BASE}/payments/p1/refunds`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body).idempotencyKey).toBe('idem-r')
  })
})

describe('connectAccounts', () => {
  it('create → POST /connect-accounts devuelve {account, onboardingUrl}', async () => {
    const fetchMock = mockFetch({ body: { data: { account: { id: 'a1' }, onboardingUrl: 'http://onboard' } } })
    const out = await client().connectAccounts.create({ email: 'x@y.com', country: 'ES', returnUrl: 'r', refreshUrl: 'f' })
    expect(out.onboardingUrl).toBe('http://onboard')
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/connect-accounts`)
  })

  it('refreshOnboardingLink → POST /connect-accounts/:id/onboarding-link con {returnUrl, refreshUrl}', async () => {
    const fetchMock = mockFetch({ body: { data: { onboardingUrl: 'http://re' } } })
    await client().connectAccounts.refreshOnboardingLink('a1', 'ret', 'ref')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${BASE}/connect-accounts/a1/onboarding-link`)
    expect(JSON.parse(init.body)).toEqual({ returnUrl: 'ret', refreshUrl: 'ref' })
  })
})
