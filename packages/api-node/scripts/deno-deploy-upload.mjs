#!/usr/bin/env node
/**
 * Upload a prebuilt api-node tree to Deno Deploy (GitHub Actions).
 * Expects dist/server.js and production node_modules/ in packages/api-node.
 */
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const entrypoint = path.join(packageRoot, 'dist/server.js')

if (!existsSync(entrypoint)) {
  console.error(`[deno-deploy] Missing ${entrypoint}. Run npm run build first.`)
  process.exit(1)
}
if (!existsSync(path.join(packageRoot, 'node_modules/better-sqlite3'))) {
  console.error('[deno-deploy] Missing node_modules/better-sqlite3. Run deploy-prune-prod after install.')
  process.exit(1)
}

const org = process.env.DENO_DEPLOY_ORG ?? 'tjm'
const app = process.env.DENO_DEPLOY_APP ?? 'vmp'
const token = process.env.DENO_DEPLOY_TOKEN
if (!token) {
  console.error('[deno-deploy] DENO_DEPLOY_TOKEN is not set.')
  process.exit(1)
}

const denoBin = process.env.DENO ?? 'deno'
const args = [
  'deploy',
  packageRoot,
  '--org',
  org,
  '--app',
  app,
  '--prod',
  '--allow-node-modules',
  '--config',
  path.join(packageRoot, 'deno.json'),
]

const result = spawnSync(denoBin, args, {
  cwd: packageRoot,
  stdio: 'inherit',
  env: { ...process.env, DENO_DEPLOY_TOKEN: token },
})

if (result.error) {
  console.error('[deno-deploy]', result.error.message)
  process.exit(1)
}
process.exit(result.status ?? 1)
