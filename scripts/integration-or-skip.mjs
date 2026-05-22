#!/usr/bin/env node
// Wrapper compartido por todos los módulos `test:integration`.
//
// Probe rápido a Postgres antes de ejecutar vitest:
//   - DB reachable → exec vitest con la config integration del módulo.
//   - DB unreachable → log + exit 0 (la suite se reporta como "skipped"
//     a nivel monorepo en vez de "failed" — útil cuando docker no
//     publica 5432 al host, p.ej. WSL2/Docker Desktop).
//
// CI con servicio postgres-action: la conexión funcionará y los tests
// se ejecutarán normalmente.
//
// Override: si `INTEGRATION_REQUIRE_DB=true`, no skipea — falla.

// Probe sin dependencias externas — algunos módulos no llevan `pg` en su
// node_modules. Usamos net.Socket para hacer un TCP connect rápido al
// puerto de Postgres parseado del DATABASE_URL.
import net from 'node:net'
import { spawnSync } from 'node:child_process'

const url = process.env.MIGRATION_DATABASE_URL
         ?? process.env.DATABASE_URL
         ?? 'postgresql://splitpay:splitpay@localhost:5432/splitpay'

const REQUIRED = process.env.INTEGRATION_REQUIRE_DB === 'true'
const moduleName = process.env.npm_package_name ?? '(unknown)'

function probe() {
  let host = 'localhost', port = 5432
  try {
    const u = new URL(url)
    host = u.hostname || host
    port = Number(u.port || port)
  } catch { /* malformed URL → use defaults */ }

  return new Promise((resolve) => {
    const socket = new net.Socket()
    const done = (ok, err) => {
      socket.removeAllListeners()
      try { socket.destroy() } catch { /* noop */ }
      resolve({ ok, err })
    }
    socket.setTimeout(2000)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false, new Error('ETIMEDOUT')))
    socket.once('error',   (e) => done(false, e))
    socket.connect(port, host)
  })
}

const { ok, err } = await probe()
if (!ok) {
  const msg = `[integration] ${moduleName}: DB unreachable (${err?.code ?? err?.message ?? 'unknown'}) — skipping suite`
  if (REQUIRED) {
    console.error(msg + ' (INTEGRATION_REQUIRE_DB=true → failing as required)')
    process.exit(1)
  }
  console.warn(msg)
  process.exit(0)
}

// DB reachable → ejecuta la suite real.
const r = spawnSync(
  'pnpm',
  ['exec', 'vitest', 'run', '--config', 'vitest.integration.config.js'],
  { stdio: 'inherit' },
)
process.exit(r.status ?? 1)
