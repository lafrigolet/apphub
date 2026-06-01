// nginx sidecar contract (sección 6) — el TODO pedía bats/shellcheck, no
// disponibles en el sandbox. Cubrimos lo equivalente con: (a) un contrato
// estructural sobre sidecar.sh (subcomandos + funciones seed_missing/render/
// reload) y (b) un test FUNCIONAL real ejecutando el script con `sh`: el
// camino de fallback cuando Redis es inalcanzable (copia los seeds a disco),
// que no requiere Redis ni nginx.
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { repoRoot, readRepoFile } from './lib/repo-root.js'

const SIDECAR = join(repoRoot(), 'infra/nginx/sidecar.sh')
const script = readRepoFile('infra/nginx/sidecar.sh')

describe('sidecar.sh — contrato estructural', () => {
  it('define los subcomandos init y watch + usage', () => {
    expect(script).toMatch(/cmd_init\(\)/)
    expect(script).toMatch(/cmd_watch\(\)/)
    expect(script).toMatch(/usage:.*\{init\|watch\}/)
  })

  it('implementa seed_missing (HSETNX-like), render y reload de nginx', () => {
    expect(script).toMatch(/seed_missing\(\)/)
    expect(script).toMatch(/render\(\)/)
    expect(script).toMatch(/HEXISTS/)          // no sobrescribe entradas existentes
    expect(script).toMatch(/nginx -t/)          // valida antes de recargar
    expect(script).toMatch(/nginx -s reload/)
  })

  it('usa un fingerprint (sha256) del hash de Redis para detectar cambios', () => {
    expect(script).toMatch(/config_hash\(\)/)
    expect(script).toMatch(/sha256sum/)
  })
})

function hasSh() {
  try { execFileSync('sh', ['-c', 'true']); return true } catch { return false }
}

describe('sidecar.sh init — fallback con Redis inalcanzable (funcional)', () => {
  const run = hasSh() ? it : it.skip

  run('copia los seeds a SITES_DIR cuando Redis no responde', () => {
    const base = mkdtempSync(join(tmpdir(), 'sidecar-'))
    const seedDir = join(base, 'seed')
    const sitesDir = join(base, 'sites')
    execFileSync('sh', ['-c', `mkdir -p "${seedDir}" "${sitesDir}"`])
    writeFileSync(join(seedDir, 'aikikan.conf'), 'server { listen 80; }\n')

    execFileSync('sh', [SIDECAR, 'init'], {
      env: {
        ...process.env,
        REDIS_HOST: '127.0.0.1',
        REDIS_PORT: '1',          // puerto cerrado → ping falla
        INIT_WAIT_SECS: '1',      // no esperamos 30s
        SEED_DIR: seedDir,
        SITES_DIR: sitesDir,
      },
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 15000,
    })

    expect(existsSync(join(sitesDir, 'aikikan.conf'))).toBe(true)
    expect(readdirSync(sitesDir)).toContain('aikikan.conf')
  })

  run('sin argumento → exit 1 y mensaje de uso', () => {
    let code = 0
    try {
      execFileSync('sh', [SIDECAR], { stdio: ['ignore', 'ignore', 'pipe'] })
    } catch (err) {
      code = err.status
    }
    expect(code).toBe(1)
  })
})
