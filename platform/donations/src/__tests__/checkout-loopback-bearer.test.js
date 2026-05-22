// REGRESSION TEST — Bug 2026-05-20:
// `donations.service.createCheckout` hace HTTP loopback a
// `/v1/splitpay/checkout-sessions` para crear la sesión Stripe. En el
// flujo público (donante sin login) NO hay Bearer, por lo que el
// loopback va sin Authorization y splitpay devuelve 401.
//
// Este fichero documenta el contrato esperado (no hay Bearer en el caso
// público) y dispara una alarma cuando la fix esté lista: actualmente
// está marcado como `.todo` en el suite "fix landed" — moverlo a `.it`
// cuando se implemente la solución (p.ej. token interno o splitpay
// /checkout-sessions público con verificación por metadata.purpose).

import { describe, it, expect, vi, beforeEach } from 'vitest'

const stubClient = { query: vi.fn() }

vi.mock('../lib/db.js', () => ({
  withTenantTransaction: vi.fn(async (_a, _t, _s, fn) => fn(stubClient)),
}))
vi.mock('../lib/env.js', () => ({
  env: { PLATFORM_CORE_BASE_URL: 'http://platform-core:3000' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../repositories/donations.repository.js', () => ({
  insert: vi.fn().mockResolvedValue({ id: 'd-public' }),
  attachSession: vi.fn(),
}))
vi.mock('../repositories/causes.repository.js', () => ({ findById: vi.fn() }))

import * as service from '../services/donations.service.js'

const validBody = {
  appId: 'aikikan',
  tenantId: '30000000-0000-0000-0000-000000000001',
  amountCents: 2500,
  currency: 'EUR',
  donorEmail: 'public@donor.org',
  kind: 'one_shot',
  successUrl: 'http://x/ok',
  cancelUrl: 'http://x/no',
}

beforeEach(() => { vi.clearAllMocks() })

// ── Contrato actual (lo que la implementación HACE hoy) ──────────────────
describe('createCheckout public path — contrato actual', () => {
  it('cuando NO hay Bearer del caller, el loopback fetch tampoco lo lleva', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { sessionId: 'cs', url: 'http://s/u' } }),
    })

    await service.createCheckout(validBody)   // sin { bearerToken }

    const headers = globalThis.fetch.mock.calls[0][1].headers
    expect(headers.Authorization).toBeUndefined()
  })

  it('reproduce el bug: si splitpay responde 401, createCheckout propaga el AppError', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { code: 'UNAUTHORIZED', message: 'Missing Authorization header' } }),
    })

    await expect(service.createCheckout(validBody)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      statusCode: 401,
    })
  })
})

// ── Contrato deseado (lo que la fix debe garantizar) ─────────────────────
//
// La fix puede tomar dos formas:
//   a) splitpay/checkout-sessions se marca `public: true` y valida por
//      `appId+tenantId` del body (sin necesidad de JWT).
//   b) donations adjunta un token interno (machine-to-machine) firmado con
//      `PLATFORM_JWT_SECRET` y `app_id: 'platform'` que app-guard acepta
//      con un atributo `internal: true` o similar.
//
// Cuando se implemente, mover estos tests a `it` y borrar los `todo`.

describe.todo('createCheckout public path — fix landed', () => {
  it.todo('cuando NO hay Bearer del caller, el loopback usa un token interno con app_id=platform')
  it.todo('splitpay/checkout-sessions acepta llamadas sin Bearer si el body trae metadata.purpose=donation y appId+tenantId válidos')
  it.todo('un caller malicioso NO puede usar el loopback de donations para crear sesiones arbitrarias de splitpay')
})
