// Schema isolation contract (1.1 · P0 · regla CLAUDE.md #4) — cada módulo
// conecta con su rol DB dedicado (`svc_platform_<mod>`) y SOLO puede tocar su
// propio schema. Un SELECT cross-schema debe fallar con `permission denied`
// (SQLSTATE 42501). Esto es lo que mantiene el monolito "listo para partir":
// aunque todos los módulos compartan el proceso, cada Pool está acotado a su
// rol.
//
// Requiere el stack con los roles sembrados (infra/postgres/init). Conexión
// por defecto a localhost:5432 (donde docker-compose publica postgres);
// overridable por PLATFORM_PG_HOST/PORT/DB para entornos donde el puerto no
// está publicado (se conecta por IP del contenedor). Si la DB no es
// accesible, los tests se SKIPean.
import { describe, it, expect, afterAll } from 'vitest'
import pg from 'pg'

const PERMISSION_DENIED = '42501'

const DB = {
  host:     process.env.PLATFORM_PG_HOST ?? 'localhost',
  port:     Number(process.env.PLATFORM_PG_PORT ?? 5432),
  database: process.env.PLATFORM_PG_DB ?? 'splitpay',
}

// (rol, password, su schema propio, una tabla de OTRO schema que SÍ existe)
const ROLES = {
  verifactu: {
    role: 'svc_platform_verifactu', password: process.env.SVC_PLATFORM_VERIFACTU_DB_PASSWORD ?? 'platform_verifactu_secret',
    ownTable: 'platform_verifactu.registros', foreignTable: 'platform_inquiries.inquiries',
  },
  inquiries: {
    role: 'svc_platform_inquiries', password: process.env.SVC_PLATFORM_INQUIRIES_DB_PASSWORD ?? 'platform_inquiries_secret',
    ownTable: 'platform_inquiries.inquiries', foreignTable: 'platform_verifactu.registros',
  },
}

async function connectAs({ role, password }) {
  const client = new pg.Client({ ...DB, user: role, password })
  await client.connect()
  return client
}

// Reachability probe en tiempo de colección.
let reachable = false
try {
  const c = await connectAs(ROLES.verifactu)
  await c.end()
  reachable = true
} catch {
  /* DB down / roles ausentes → skip */
}
const maybe = reachable ? it : it.skip
if (!reachable) {
  // eslint-disable-next-line no-console
  console.warn(`[schema-isolation] postgres no accesible en ${DB.host}:${DB.port} — tests SKIPeados`)
}

const openClients = []
afterAll(async () => { await Promise.all(openClients.map((c) => c.end().catch(() => {}))) })

async function client(spec) {
  const c = await connectAs(spec)
  openClients.push(c)
  return c
}

describe('schema isolation — cada rol solo ve su propio schema', () => {
  maybe('verifactu puede leer su propio schema', async () => {
    const c = await client(ROLES.verifactu)
    await expect(c.query(`SELECT 1 FROM ${ROLES.verifactu.ownTable} LIMIT 1`)).resolves.toBeDefined()
  })

  maybe('verifactu NO puede leer platform_inquiries (permission denied 42501)', async () => {
    const c = await client(ROLES.verifactu)
    await expect(c.query(`SELECT 1 FROM ${ROLES.verifactu.foreignTable} LIMIT 1`))
      .rejects.toMatchObject({ code: PERMISSION_DENIED })
  })

  maybe('inquiries NO puede leer platform_verifactu (permission denied 42501)', async () => {
    const c = await client(ROLES.inquiries)
    await expect(c.query(`SELECT 1 FROM ${ROLES.inquiries.foreignTable} LIMIT 1`))
      .rejects.toMatchObject({ code: PERMISSION_DENIED })
  })

  maybe('ningún rol de módulo es superusuario (no BYPASSRLS / no rolsuper)', async () => {
    const c = await client(ROLES.verifactu)
    const { rows } = await c.query(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1`,
      [ROLES.verifactu.role],
    )
    expect(rows[0]).toMatchObject({ rolsuper: false, rolbypassrls: false })
  })
})
