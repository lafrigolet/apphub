// CI workflows contract (sección 6) — verifica que los GitHub Actions
// declaran lo que el TODO exige, sin necesitar un runner:
//   - ci.yml: job de test con services postgres+redis e instala/typecheck/lint/test.
//   - deploy.yml + deploy/services.json: aulavera-portal y aulavera-server
//     están en la matriz de build/deploy (salen del workflow).
import { describe, it, expect } from 'vitest'
import { readRepoFile } from './lib/repo-root.js'

const ci = readRepoFile('.github/workflows/ci.yml')
const deploy = readRepoFile('.github/workflows/deploy.yml')
const services = JSON.parse(readRepoFile('deploy/services.json'))

describe('ci.yml — job de test', () => {
  it('declara un job `test` con services postgres + redis', () => {
    expect(ci).toMatch(/jobs:/)
    expect(ci).toMatch(/^\s+test:/m)
    expect(ci).toMatch(/postgres:\s*\n\s*image:\s*postgres:16/)
    expect(ci).toMatch(/redis:\s*\n\s*image:\s*redis:7/)
  })

  it('instala deps + typecheck + lint + test', () => {
    expect(ci).toMatch(/pnpm install --frozen-lockfile/)
    expect(ci).toMatch(/run:\s*pnpm typecheck/)
    expect(ci).toMatch(/run:\s*pnpm lint/)
    expect(ci).toMatch(/run:\s*pnpm test/)
  })

  it('expone DATABASE_URL + REDIS_URL al paso de test', () => {
    expect(ci).toMatch(/DATABASE_URL:\s*postgresql:\/\/.*:5432\/splitpay/)
    expect(ci).toMatch(/REDIS_URL:\s*redis:\/\/localhost:6379/)
  })
})

describe('deploy.yml + services.json — aulavera sale del workflow', () => {
  it('deploy.yml dispara en push a main y usa la matriz por servicio', () => {
    expect(deploy).toMatch(/branches:\s*\[main\]/)
    expect(deploy).toMatch(/detect-changes/)
    expect(deploy).toMatch(/matrix/)
  })

  it('aulavera entra en la matriz vía los contenedores consolidados (ADR 017/018)', () => {
    // Tras ADR 017 (un solo contenedor `portals` para los frontends) y ADR 018
    // (un solo `apps-servers` para los app-servers), no hay servicios standalone
    // aulavera-portal/aulavera-server: el frontend de aulavera se construye con
    // `portals` y el backend con `apps-servers`. Un cambio en aulavera sigue
    // disparando build/deploy porque sus paths están en esos servicios.
    const list = services.services ?? services
    const byName = new Map(list.map((s) => [s.name, s]))
    const portals = byName.get('portals')
    const appsServers = byName.get('apps-servers')
    expect(portals).toBeTruthy()
    expect(appsServers).toBeTruthy()
    expect(portals.paths).toContain('apps/aulavera/aulavera-portal/**')
    expect(appsServers.paths).toContain('apps/aulavera/aulavera-server/**')
  })

  it('cada servicio declara name + dockerfile + paths (contrato de la matriz)', () => {
    const list = services.services ?? services
    for (const s of list) {
      expect(typeof s.name).toBe('string')
      expect(typeof s.dockerfile).toBe('string')
      expect(Array.isArray(s.paths)).toBe(true)
    }
  })
})
