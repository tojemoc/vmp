#!/usr/bin/env node
/** Drop devDependencies after build; keep runtime native modules (better-sqlite3, AWS SDK). */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const npmBin = process.env.NPM || 'npm'

const result = spawnSync(npmBin, ['prune', '--omit=dev', '--no-workspaces'], {
  cwd: packageRoot,
  stdio: 'inherit',
  env: { ...process.env, NPM_CONFIG_WORKSPACES: 'false' },
})

if (result.error) {
  console.error('[deploy-prune-prod]', result.error.message)
  process.exit(1)
}
process.exit(result.status ?? 1)
