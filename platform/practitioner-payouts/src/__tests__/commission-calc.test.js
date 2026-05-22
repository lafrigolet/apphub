// Cálculo de comisión para profesionales (% del bruto + opcional flat fee).
// Función pura `computeCommission({ grossCents, ratePct, flatFeeCents })`.
// Edge cases críticos:
//   - ratePct=0 → solo flat fee (modelo "salario fijo + 0% variable")
//   - flatFeeCents=0/undefined → solo % (modelo "puro variable")
//   - grossCents=0 → solo flat fee (sirve para cargos mínimos)
//   - Redondeo a céntimo entero (Stripe trabaja en céntimos enteros)
//   - Resultado nunca negativo (Math.max 0)
//
// NOTA fiscal: el cálculo NO contempla retenciones IRPF — eso vive en
// el job de cierre (closePeriod). Aquí solo es bruto-a-bruto.

import { describe, it, expect, vi } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn() },
  withTenantTransaction: vi.fn(),
}))
vi.mock('../lib/redis.js', () => ({ publish: vi.fn(), subscribe: vi.fn() }))
vi.mock('../repositories/practitioner-payouts.repository.js')

import { computeCommission } from '../services/practitioner-payouts.service.js'

describe('computeCommission — happy path %', () => {
  it('20% sobre 10.000 céntimos = 2.000 céntimos', () => {
    expect(computeCommission({ grossCents: 10000, ratePct: 20 })).toBe(2000)
  })

  it('50% sobre 12.345 céntimos = 6.173 (redondeado al céntimo)', () => {
    expect(computeCommission({ grossCents: 12345, ratePct: 50 })).toBe(6173)
  })

  it('0% sobre cualquier importe = 0', () => {
    expect(computeCommission({ grossCents: 5000, ratePct: 0 })).toBe(0)
  })

  it('100% sobre bruto = el bruto entero', () => {
    expect(computeCommission({ grossCents: 7500, ratePct: 100 })).toBe(7500)
  })
})

describe('computeCommission — combinación % + flat fee', () => {
  it('20% sobre 10.000 + 500 flat = 2.500', () => {
    expect(computeCommission({ grossCents: 10000, ratePct: 20, flatFeeCents: 500 })).toBe(2500)
  })

  it('0% sobre 10.000 + 200 flat = 200 (solo el flat)', () => {
    expect(computeCommission({ grossCents: 10000, ratePct: 0, flatFeeCents: 200 })).toBe(200)
  })

  it('grossCents=0 + 100 flat = 100 (cargo mínimo)', () => {
    expect(computeCommission({ grossCents: 0, ratePct: 30, flatFeeCents: 100 })).toBe(100)
  })

  it('grossCents=0 + sin flat = 0 (no negativo)', () => {
    expect(computeCommission({ grossCents: 0, ratePct: 30 })).toBe(0)
  })

  it('flatFeeCents undefined se trata como 0', () => {
    expect(computeCommission({ grossCents: 1000, ratePct: 10 })).toBe(100)
    expect(computeCommission({ grossCents: 1000, ratePct: 10, flatFeeCents: undefined })).toBe(100)
  })

  it('flatFeeCents null se trata como 0', () => {
    expect(computeCommission({ grossCents: 1000, ratePct: 10, flatFeeCents: null })).toBe(100)
  })
})

describe('computeCommission — redondeo a céntimos enteros', () => {
  it('33.33% sobre 100 céntimos = 33 (redondeado banker)', () => {
    expect(computeCommission({ grossCents: 100, ratePct: 33.33 })).toBe(33)
  })

  it('33.34% sobre 100 céntimos = 33', () => {
    expect(computeCommission({ grossCents: 100, ratePct: 33.34 })).toBe(33)
  })

  it('50% sobre 1 céntimo = 1 (Math.round(0.5) en banca = 0 pero JS Math.round redondea a 1)', () => {
    expect(computeCommission({ grossCents: 1, ratePct: 50 })).toBe(1)
  })

  it('siempre devuelve número entero (Math.round)', () => {
    const r = computeCommission({ grossCents: 100, ratePct: 33.333 })
    expect(Number.isInteger(r)).toBe(true)
  })
})

describe('computeCommission — sanitización de inputs', () => {
  it('ratePct null o undefined → 0 (default seguro)', () => {
    expect(computeCommission({ grossCents: 10000, ratePct: null })).toBe(0)
    expect(computeCommission({ grossCents: 10000, ratePct: undefined })).toBe(0)
  })

  it('grossCents negativo + flat → solo el flat (no negativo)', () => {
    // Math.max(0, neg + flat) = max si neg+flat<0
    expect(computeCommission({ grossCents: -10000, ratePct: 20, flatFeeCents: 500 })).toBe(0)
  })

  it('grossCents string-numérico se coerce a número', () => {
    expect(computeCommission({ grossCents: '10000', ratePct: 20 })).toBe(2000)
  })
})

describe('computeCommission — escenarios reales', () => {
  it('Profesional autónomo: 70% bruto + retención (la retención va aparte)', () => {
    // Sesión de 50€ (5.000 céntimos), comisión 70% → 3.500 céntimos brutos.
    // La retención IRPF se aplica en closePeriod, no aquí.
    expect(computeCommission({ grossCents: 5000, ratePct: 70 })).toBe(3500)
  })

  it('Plataforma se queda 15% (profesional 85%)', () => {
    expect(computeCommission({ grossCents: 10000, ratePct: 85 })).toBe(8500)
  })

  it('Flat fee mínima por sesión (modelo coworking): 500 fijos + 0%', () => {
    expect(computeCommission({ grossCents: 5000, ratePct: 0, flatFeeCents: 500 })).toBe(500)
  })

  it('Modelo "cuota mensual + 10% por hora": 10000 fijos + 10% por consumo', () => {
    expect(computeCommission({ grossCents: 20000, ratePct: 10, flatFeeCents: 10000 })).toBe(12000)
  })
})
