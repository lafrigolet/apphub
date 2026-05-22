// Contrato del DB helper compartido. Lo críticos:
//   - withTenantTransaction setea los 3 GUCs RLS (`app.app_id`,
//     `app.tenant_id`, `app.sub_tenant_id`) DENTRO de la transacción
//     (regla CLAUDE.md #1, #2, #7).
//   - Commit en éxito, ROLLBACK en error.
//   - Cliente SIEMPRE liberado al pool (incluido en error).
//   - withTransaction sin contexto (migrations, ops platform).

import { describe, it, expect, vi, beforeEach } from 'vitest'

// pg.Pool tiene side-effects al instanciar — mockeamos para evitar
// abrir conexiones reales con un postgres inexistente.
vi.mock('pg', () => {
  class FakePool {
    constructor() { this.on = vi.fn() }
  }
  return { default: { Pool: FakePool } }
})

import { createPool, setTenantContext, withTenantTransaction, withTransaction } from '../db.js'

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => vi.clearAllMocks())

// ── createPool ──────────────────────────────────────────────────────

describe('createPool', () => {
  it('crea un pg.Pool y registra handler de error', () => {
    const p = createPool('postgresql://x:y@localhost:5432/test')
    expect(p.on).toHaveBeenCalledWith('error', expect.any(Function))
  })
})

// ── setTenantContext ────────────────────────────────────────────────

describe('setTenantContext — los 3 GUCs RLS', () => {
  it('setea app.app_id, app.tenant_id, app.sub_tenant_id como txn-local (set_config con true)', async () => {
    const c = mockClient()
    await setTenantContext(c, 'aulavera', 't-1', 'st-1')
    expect(c.query).toHaveBeenNthCalledWith(1, 'SELECT set_config($1, $2, true)', ['app.app_id', 'aulavera'])
    expect(c.query).toHaveBeenNthCalledWith(2, 'SELECT set_config($1, $2, true)', ['app.tenant_id', 't-1'])
    expect(c.query).toHaveBeenNthCalledWith(3, 'SELECT set_config($1, $2, true)', ['app.sub_tenant_id', 'st-1'])
  })

  it('sub_tenant_id null se pasa como string vacío (Postgres no acepta NULL en set_config)', async () => {
    const c = mockClient()
    await setTenantContext(c, 'aulavera', 't-1', null)
    expect(c.query).toHaveBeenNthCalledWith(3, 'SELECT set_config($1, $2, true)', ['app.sub_tenant_id', ''])
  })

  it('sub_tenant_id undefined → string vacío también', async () => {
    const c = mockClient()
    await setTenantContext(c, 'aulavera', 't-1', undefined)
    expect(c.query).toHaveBeenNthCalledWith(3, 'SELECT set_config($1, $2, true)', ['app.sub_tenant_id', ''])
  })
})

// ── withTenantTransaction ───────────────────────────────────────────

describe('withTenantTransaction', () => {
  it('orden: BEGIN → setTenantContext (3 queries) → fn → COMMIT → release', async () => {
    const c = mockClient()
    const pool = { connect: vi.fn().mockResolvedValue(c) }
    const fn = vi.fn(async (cl) => {
      await cl.query('SELECT 1')
      return 'ok'
    })

    const r = await withTenantTransaction(pool, 'aulavera', 't-1', null, fn)

    expect(r).toBe('ok')
    // Order of queries on client:
    //   1: BEGIN
    //   2,3,4: set_config × 3
    //   5: SELECT 1 (de fn)
    //   6: COMMIT
    const calls = c.query.mock.calls.map((c) => c[0])
    expect(calls[0]).toBe('BEGIN')
    expect(calls.slice(1, 4)).toEqual(Array(3).fill('SELECT set_config($1, $2, true)'))
    expect(calls[4]).toBe('SELECT 1')
    expect(calls[5]).toBe('COMMIT')
    expect(c.release).toHaveBeenCalledTimes(1)
  })

  it('ROLLBACK + release cuando fn lanza, y propaga el error', async () => {
    const c = mockClient()
    const pool = { connect: vi.fn().mockResolvedValue(c) }
    const err = new Error('boom inside fn')

    await expect(
      withTenantTransaction(pool, 'a', 't', null, async () => { throw err }),
    ).rejects.toBe(err)

    const calls = c.query.mock.calls.map((c) => c[0])
    expect(calls).toContain('BEGIN')
    expect(calls).toContain('ROLLBACK')
    expect(calls).not.toContain('COMMIT')
    expect(c.release).toHaveBeenCalledTimes(1)
  })

  it('SI el ROLLBACK FAIL, el error original se propaga (no oculta diagnóstico)', async () => {
    const c = {
      query: vi.fn((sql) => {
        if (sql === 'ROLLBACK') return Promise.reject(new Error('rollback fail'))
        return Promise.resolve({ rows: [] })
      }),
      release: vi.fn(),
    }
    const pool = { connect: vi.fn().mockResolvedValue(c) }

    await expect(
      withTenantTransaction(pool, 'a', 't', null, async () => { throw new Error('original') }),
    ).rejects.toThrow(/rollback fail|original/)
    expect(c.release).toHaveBeenCalledTimes(1)
  })

  it('libera el cliente incluso si BEGIN falla', async () => {
    const c = {
      query: vi.fn((sql) => sql === 'BEGIN'
        ? Promise.reject(new Error('begin fail'))
        : Promise.resolve({ rows: [] })),
      release: vi.fn(),
    }
    const pool = { connect: vi.fn().mockResolvedValue(c) }

    await expect(
      withTenantTransaction(pool, 'a', 't', null, async () => 'never'),
    ).rejects.toThrow('begin fail')
    expect(c.release).toHaveBeenCalledTimes(1)
  })

  it('GUCs persistirán solo en esta transacción (set_config con local=true)', async () => {
    // Verificamos que el 3er arg del set_config es siempre TRUE
    // (significa "scope local a la transacción"). Si alguien lo
    // cambia a false (=session), las queries fuera de la transacción
    // verían el mismo tenant — fuga de contexto.
    const c = mockClient()
    const pool = { connect: vi.fn().mockResolvedValue(c) }
    await withTenantTransaction(pool, 'a', 't', null, async () => 'ok')

    const setConfigCalls = c.query.mock.calls.filter((c) => c[0] === 'SELECT set_config($1, $2, true)')
    expect(setConfigCalls).toHaveLength(3)   // 3 GUCs
    // El SQL literal contiene `true` como 3er parámetro hardcoded.
  })
})

// ── withTransaction (sin tenant) ────────────────────────────────────

describe('withTransaction — para migrations / platform ops', () => {
  it('BEGIN → fn → COMMIT, SIN set_config (no hay tenant en migrations)', async () => {
    const c = mockClient()
    const pool = { connect: vi.fn().mockResolvedValue(c) }
    await withTransaction(pool, async (cl) => { await cl.query('CREATE TABLE x') })
    const calls = c.query.mock.calls.map((c) => c[0])
    expect(calls).toEqual(['BEGIN', 'CREATE TABLE x', 'COMMIT'])
    expect(calls).not.toContain(expect.stringContaining('set_config'))
  })

  it('ROLLBACK + propagación en error', async () => {
    const c = mockClient()
    const pool = { connect: vi.fn().mockResolvedValue(c) }
    await expect(
      withTransaction(pool, async () => { throw new Error('ddl fail') }),
    ).rejects.toThrow('ddl fail')
    expect(c.query.mock.calls.map((c) => c[0])).toContain('ROLLBACK')
    expect(c.release).toHaveBeenCalled()
  })
})
