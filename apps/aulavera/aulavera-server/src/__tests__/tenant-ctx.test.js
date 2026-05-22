// tenant-ctx — extracción de tenantId para rutas PÚBLICAS.
// Contrato:
//   - Prioridad: JWT Bearer > query param ?tenantId=.
//   - JWT payload decode SIN verificar firma (lectura-only en públicas);
//     la firma sólo importa para escrituras autenticadas.
//   - JWT con exp pasado → UnauthorizedError (auth claim mal-usada).
//   - JWT bien formado pero sin tenant_id → falla y prueba query param.
//   - JWT corrupto / no-base64 → catch silencioso, prueba query param.
//   - Ni JWT ni query → ValidationError.

import { describe, it, expect } from 'vitest'
import { tenantFromRequest } from '../lib/tenant-ctx.js'

function jwtOf(payload) {
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body    = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.sig_ignored`
}

const TENANT = '22222222-2222-2222-2222-222222222222'
const FUTURE = Math.floor(Date.now() / 1000) + 3600
const PAST   = Math.floor(Date.now() / 1000) - 3600

// ── Sin auth ni query → ValidationError ────────────────────────────

describe('sin Bearer y sin query', () => {
  it('falta todo → ValidationError "tenantId requerido"', () => {
    expect(() => tenantFromRequest({ headers: {}, query: {} })).toThrow(/tenantId requerido/)
  })

  it('query tenantId vacío → ValidationError', () => {
    expect(() => tenantFromRequest({ headers: {}, query: { tenantId: '' } })).toThrow(/tenantId/)
  })

  it('query tenantId no-string (number) → ValidationError', () => {
    expect(() => tenantFromRequest({ headers: {}, query: { tenantId: 42 } })).toThrow(/tenantId/)
  })
})

// ── JWT vía Authorization Bearer ───────────────────────────────────

describe('JWT Bearer', () => {
  it('happy: JWT con tenant_id válido → retorna tenant_id', () => {
    const token = jwtOf({ tenant_id: TENANT, exp: FUTURE, sub: 'u1', app_id: 'aulavera' })
    const r = tenantFromRequest({ headers: { authorization: `Bearer ${token}` }, query: {} })
    expect(r).toBe(TENANT)
  })

  it('JWT con exp pasado → UnauthorizedError "Token expired"', () => {
    const token = jwtOf({ tenant_id: TENANT, exp: PAST, sub: 'u1' })
    expect(() => tenantFromRequest({ headers: { authorization: `Bearer ${token}` }, query: {} }))
      .toThrow(/Token expired/)
  })

  it('JWT SIN tenant_id → cae a query param', () => {
    const token = jwtOf({ exp: FUTURE, sub: 'u1' })
    const r = tenantFromRequest({
      headers: { authorization: `Bearer ${token}` },
      query: { tenantId: TENANT },
    })
    expect(r).toBe(TENANT)
  })

  it('JWT SIN tenant_id ni query → ValidationError', () => {
    const token = jwtOf({ exp: FUTURE, sub: 'u1' })
    expect(() => tenantFromRequest({
      headers: { authorization: `Bearer ${token}` }, query: {},
    })).toThrow(/tenantId/)
  })

  it('JWT corrupto (no base64) → cae a query param', () => {
    const r = tenantFromRequest({
      headers: { authorization: 'Bearer not.a.valid.jwt' },
      query: { tenantId: TENANT },
    })
    expect(r).toBe(TENANT)
  })

  it('JWT sin payload (token "Bearer" solo) → cae a query', () => {
    const r = tenantFromRequest({
      headers: { authorization: 'Bearer ' },
      query: { tenantId: TENANT },
    })
    expect(r).toBe(TENANT)
  })

  it('JWT con payload incompleto (sin "."s) → cae a query', () => {
    const r = tenantFromRequest({
      headers: { authorization: 'Bearer onlyheader' },
      query: { tenantId: TENANT },
    })
    expect(r).toBe(TENANT)
  })

  it('JWT sin exp (token "permanente") → no checa expiry, usa tenant_id', () => {
    const token = jwtOf({ tenant_id: TENANT, sub: 'u1' })
    const r = tenantFromRequest({
      headers: { authorization: `Bearer ${token}` }, query: {},
    })
    expect(r).toBe(TENANT)
  })
})

// ── Query param fallback ───────────────────────────────────────────

describe('?tenantId= query param', () => {
  it('sin auth + query tenantId presente → usa query', () => {
    const r = tenantFromRequest({ headers: {}, query: { tenantId: TENANT } })
    expect(r).toBe(TENANT)
  })

  it('Authorization no-Bearer + query → usa query', () => {
    const r = tenantFromRequest({
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
      query: { tenantId: TENANT },
    })
    expect(r).toBe(TENANT)
  })
})

// ── Prioridad: JWT > query (cuando ambos válidos) ──────────────────

describe('prioridad JWT > query', () => {
  it('JWT válido + query distinto → gana JWT', () => {
    const token = jwtOf({ tenant_id: TENANT, exp: FUTURE, sub: 'u1' })
    const r = tenantFromRequest({
      headers: { authorization: `Bearer ${token}` },
      query: { tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
    })
    expect(r).toBe(TENANT)                          // JWT prevalece
  })
})
