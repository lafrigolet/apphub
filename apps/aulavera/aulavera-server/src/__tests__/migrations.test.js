// migrate.runMigrations — runner de migraciones idempotente (1.x · P1).
// Contrato:
//   - crea schema + tabla de control `migrations` (filename UNIQUE).
//   - aplica SOLO los .sql aún no registrados, en orden alfabético.
//   - cada migración: BEGIN → ejecuta SQL → INSERT en migrations → COMMIT.
//   - error en una migración → ROLLBACK + throw (no marca como aplicada).
//   - reaplicar cuando todo está aplicado → no-op (idempotente).
//   - libera client + cierra pool en finally.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { PoolMock, client, readdirMock, readFileMock } = vi.hoisted(() => {
  const client = { query: vi.fn(), release: vi.fn() }
  const poolInstance = { connect: vi.fn(async () => client), end: vi.fn(async () => {}) }
  return {
    PoolMock: vi.fn(() => poolInstance),
    client,
    readdirMock: vi.fn(),
    readFileMock: vi.fn(async (p) => `-- sql for ${p}`),
  }
})

vi.mock('pg', () => ({ default: { Pool: PoolMock } }))
vi.mock('fs/promises', () => ({ readdir: readdirMock, readFile: readFileMock }))
vi.mock('../lib/env.js', () => ({ env: { MIGRATION_DATABASE_URL: 'postgresql://su@localhost/db', DATABASE_URL: 'postgresql://app@localhost/db' } }))
vi.mock('../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))

import { runMigrations } from '../lib/migrate.js'

// Helper: configura client.query para una corrida.
//   appliedRows = filas que ya constan en la tabla migrations.
function setup({ appliedRows = [], files = ['0001_init.sql', '0002_seed.sql'], failOn = null } = {}) {
  readdirMock.mockResolvedValue([...files, 'notes.txt']) // .txt se ignora
  client.query.mockImplementation(async (sql) => {
    if (/SELECT filename FROM/.test(sql)) return { rows: appliedRows.map((f) => ({ filename: f })) }
    if (failOn && sql.includes(failOn)) throw new Error('migration failed')
    return { rows: [] }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  readFileMock.mockImplementation(async (p) => `-- sql for ${p}`)
})

describe('runMigrations', () => {
  it('crea schema + tabla de control migrations', async () => {
    setup({ appliedRows: ['0001_init.sql', '0002_seed.sql'] }) // nada pendiente
    await runMigrations()
    const sqls = client.query.mock.calls.map((c) => c[0])
    expect(sqls.some((s) => /CREATE SCHEMA IF NOT EXISTS app_aulavera/.test(s))).toBe(true)
    expect(sqls.some((s) => /CREATE TABLE IF NOT EXISTS app_aulavera\.migrations/.test(s))).toBe(true)
  })

  it('aplica solo los .sql pendientes (idempotencia): 0001 ya aplicada → solo corre 0002', async () => {
    setup({ appliedRows: ['0001_init.sql'] })
    await runMigrations()
    const sqls = client.query.mock.calls.map((c) => c[0])
    // 0002 se aplica: hay un BEGIN/COMMIT y un INSERT con su filename
    const insertCalls = client.query.mock.calls.filter(([s]) => /INSERT INTO app_aulavera\.migrations/.test(s))
    expect(insertCalls).toHaveLength(1)
    expect(insertCalls[0][1]).toEqual(['0002_seed.sql'])
    expect(sqls.filter((s) => s === 'BEGIN')).toHaveLength(1)
    expect(sqls.filter((s) => s === 'COMMIT')).toHaveLength(1)
    // 0001 NO se re-ejecuta
    expect(readFileMock).toHaveBeenCalledTimes(1)
    expect(readFileMock.mock.calls[0][0]).toMatch(/0002_seed\.sql$/)
  })

  it('cada migración pendiente: BEGIN → SQL → INSERT → COMMIT', async () => {
    setup({ appliedRows: [] })
    await runMigrations()
    const order = client.query.mock.calls.map((c) => c[0])
    const beginIdx = order.indexOf('BEGIN')
    const commitIdx = order.indexOf('COMMIT')
    expect(beginIdx).toBeGreaterThanOrEqual(0)
    expect(commitIdx).toBeGreaterThan(beginIdx)
    // dos migraciones pendientes → 2 BEGIN, 2 COMMIT, 2 INSERT
    expect(order.filter((s) => s === 'BEGIN')).toHaveLength(2)
    expect(order.filter((s) => s === 'COMMIT')).toHaveLength(2)
    expect(client.query.mock.calls.filter(([s]) => /INSERT INTO app_aulavera\.migrations/.test(s))).toHaveLength(2)
  })

  it('reaplicar con todo aplicado → no BEGIN/INSERT (no-op idempotente)', async () => {
    setup({ appliedRows: ['0001_init.sql', '0002_seed.sql'] })
    await runMigrations()
    const sqls = client.query.mock.calls.map((c) => c[0])
    expect(sqls).not.toContain('BEGIN')
    expect(sqls.some((s) => /INSERT INTO app_aulavera\.migrations/.test(s))).toBe(false)
    expect(readFileMock).not.toHaveBeenCalled()
  })

  it('error en una migración → ROLLBACK + throw; no marca como aplicada', async () => {
    // 0001 corre OK, 0002 falla al ejecutar su SQL.
    readdirMock.mockResolvedValue(['0001_init.sql', '0002_seed.sql'])
    readFileMock.mockImplementation(async (p) => (p.includes('0002') ? 'BOOM_SQL' : 'OK_SQL'))
    client.query.mockImplementation(async (sql) => {
      if (/SELECT filename FROM/.test(sql)) return { rows: [] }
      if (sql === 'BOOM_SQL') throw new Error('syntax error')
      return { rows: [] }
    })
    await expect(runMigrations()).rejects.toThrow(/syntax error/)
    const sqls = client.query.mock.calls.map((c) => c[0])
    expect(sqls).toContain('ROLLBACK')
    // 0002 no se registra como aplicada
    const inserts = client.query.mock.calls.filter(([s]) => /INSERT INTO app_aulavera\.migrations/.test(s))
    expect(inserts.every(([, params]) => params[0] !== '0002_seed.sql')).toBe(true)
  })

  it('libera client + cierra pool en finally', async () => {
    setup({ appliedRows: ['0001_init.sql', '0002_seed.sql'] })
    await runMigrations()
    expect(client.release).toHaveBeenCalled()
    const poolInstance = PoolMock.mock.results[0].value
    expect(poolInstance.end).toHaveBeenCalled()
  })
})
