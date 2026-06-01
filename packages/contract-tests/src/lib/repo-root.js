import { dirname, join, resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Localiza la raíz del monorepo subiendo hasta encontrar pnpm-workspace.yaml.
export function repoRoot() {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  return process.cwd()
}

export function readRepoFile(relPath) {
  return readFileSync(join(repoRoot(), relPath), 'utf8')
}
