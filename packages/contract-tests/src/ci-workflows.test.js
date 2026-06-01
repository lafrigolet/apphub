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

  it('services.json incluye aulavera-portal y aulavera-server con Dockerfile', () => {
    const list = services.services ?? services
    const byName = new Map(list.map((s) => [s.name, s]))
    expect(byName.has('aulavera-portal')).toBe(true)
    expect(byName.has('aulavera-server')).toBe(true)
    expect(byName.get('aulavera-portal').dockerfile).toMatch(/apps\/aulavera\/aulavera-portal\/Dockerfile/)
    expect(byName.get('aulavera-server').dockerfile).toMatch(/apps\/aulavera\/aulavera-server\/Dockerfile/)
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
