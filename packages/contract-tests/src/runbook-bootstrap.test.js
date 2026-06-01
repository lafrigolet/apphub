// runbook bootstrap contract (sección 6 · P2) — el runbook de bootstrap debe
// documentar un proceso idempotente y verificable. Test file-contract sobre
// docs/runbooks/platform-bootstrap.md.
import { describe, it, expect } from 'vitest'
import { readRepoFile } from './lib/repo-root.js'

const md = readRepoFile('docs/runbooks/platform-bootstrap.md')

describe('platform-bootstrap.md', () => {
  it('documenta explícitamente la idempotencia', () => {
    expect(md).toMatch(/##\s*Idempotency/i)
    expect(md).toMatch(/idempotent/i)
  })

  it('cubre arranque tras wipe del volumen (docker compose down -v)', () => {
    expect(md).toMatch(/docker compose down -v/)
  })

  it('da una vía no-interactiva (CI/automation)', () => {
    expect(md).toMatch(/Non-interactive|CI\/automation/i)
  })

  it('incluye un comando de verificación (psql) y los outputs esperados', () => {
    expect(md).toMatch(/psql -U splitpay -d splitpay/)
    expect(md).toMatch(/##\s*Outputs/i)
  })
})
