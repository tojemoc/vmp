#!/usr/bin/env node
/**
 * Deno Deploy runs `npm` through Deno's npm shim, which ignores packages/api-node/.npmrc
 * and still resolves the monorepo workspace (npm ci then fails with root lockfile drift).
 * Use the real Node/npm binary when available (CI, local), with an explicit --no-workspaces install.
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const npmBin = process.env.NPM || 'npm'
const args = ['ci', '--no-workspaces', '--foreground-scripts']

const result = spawnSync(npmBin, args, {
  cwd: packageRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    NPM_CONFIG_WORKSPACES: 'false',
  },
})

if (result.error) {
  console.error('[deploy-install]', result.error.message)
  process.exit(1)
}
process.exit(result.status ?? 1)
