// postgres-init contract (sección 6 · P0) — verifica que los scripts de
// init declaran TODOS los schemas y roles dedicados por módulo (regla
// CLAUDE.md #4/#11). Es la versión file-contract (siempre corre); el chequeo
// en runtime (que existen de verdad) vive en
// integration/postgres-roles.integration.test.js (skip si no hay PG).
import { describe, it, expect } from 'vitest'
import { readRepoFile } from './lib/repo-root.js'

const sql = readRepoFile('infra/postgres/init/01_platform_schemas.sql')

// Módulos platform que requieren schema + rol dedicado (excluye basket: Redis-only).
const MODULES = [
  'auth', 'payments', 'notifications', 'catalog', 'tenants',
  'orders', 'inventory', 'reviews', 'messaging', 'shipping', 'disputes',
  'menu', 'reservations', 'floor_plan', 'kds', 'pos', 'delivery_dispatch',
  'services', 'resources', 'bookings', 'availability', 'intake_forms',
  'telehealth', 'packages', 'practitioner_payouts',
  'scheduler', 'storage', 'leads', 'donations', 'inquiries', 'verifactu',
]

describe('01_platform_schemas.sql — schemas por módulo', () => {
  it.each(MODULES)('declara CREATE SCHEMA platform_%s', (m) => {
    expect(sql).toMatch(new RegExp(`CREATE SCHEMA IF NOT EXISTS platform_${m}\\b`))
  })
})

describe('01_platform_schemas.sql — roles dedicados', () => {
  it.each(MODULES)('declara el rol svc_platform_%s con LOGIN PASSWORD', (m) => {
    expect(sql).toMatch(new RegExp(`CREATE ROLE svc_platform_${m} LOGIN PASSWORD`))
  })

  it('cada CREATE ROLE va guardado por IF NOT EXISTS (idempotente)', () => {
    // Tantos guards pg_roles como roles creados.
    const guards = (sql.match(/IF NOT EXISTS \(SELECT FROM pg_roles WHERE rolname/g) ?? []).length
    const creates = (sql.match(/CREATE ROLE svc_platform_/g) ?? []).length
    expect(guards).toBeGreaterThanOrEqual(creates)
  })
})

describe('init dir — orden y apps', () => {
  it('los schemas de app (aikikan, aulavera) tienen su propio init', () => {
    const aikikan = readRepoFile('infra/postgres/init/15_app_aikikan_schema.sql')
    const aulavera = readRepoFile('infra/postgres/init/16_app_aulavera_schema.sql')
    expect(aikikan).toMatch(/app_aikikan/)
    expect(aulavera).toMatch(/app_aulavera/)
  })
})
