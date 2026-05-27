#!/usr/bin/env node
/**
 * Upload a prebuilt api-node tree to Deno Deploy (GitHub Actions).
 * Expects dist/server.js and production node_modules/ in packages/api-node.
 */

import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)

const entrypoint = path.join(packageRoot, 'dist/server.js')

if (!existsSync(entrypoint)) {
  console.error(
    `[deno-deploy] Missing ${entrypoint}. Run npm run build first.`,
  )
  process.exit(1)
}

if (!existsSync(path.join(packageRoot, 'node_modules/postgres'))) {
  console.error(
    '[deno-deploy] Missing node_modules/postgres. Run deploy-prune-prod after install.',
  )
  process.exit(1)
}

const org = process.env.DENO_DEPLOY_ORG
const app = process.env.DENO_DEPLOY_APP
const token = process.env.DENO_DEPLOY_TOKEN

if (!org) {
  console.error('[deno-deploy] DENO_DEPLOY_ORG is not set.')
  process.exit(1)
}

if (!app) {
  console.error('[deno-deploy] DENO_DEPLOY_APP is not set.')
  process.exit(1)
}

if (!token) {
  console.error('[deno-deploy] DENO_DEPLOY_TOKEN is not set.')
  process.exit(1)
}

const denoBin = process.env.DENO ?? 'deno'

const args = [
  'deploy',
  '.',
  '--org',
  org,
  '--app',
  app,
  '--prod',
  '--allow-node-modules',
]

console.log('[deno-deploy] Deploying prebuilt api-node bundle...')
console.log(`[deno-deploy] org=${org}`)
console.log(`[deno-deploy] app=${app}`)
console.log(`[deno-deploy] entrypoint=${entrypoint}`)
console.log('\n[deno-deploy] Upload root:', packageRoot)
console.log('[deno-deploy] Entry file exists:', existsSync(entrypoint))

console.log('\n[deno-deploy] DIST tree:')
console.log(execSync('ls -R dist || true', { cwd: packageRoot }).toString())

console.log('\n[deno-deploy] FULL package tree (api-node):')
console.log(execSync('find . -maxdepth 3 -type f || true', { cwd: packageRoot }).toString())
console.log('\n[deno-deploy] CLI args:')
console.log(JSON.stringify(args, null, 2))
console.log('\n[deno-deploy] SIMULATED ROOT VIEW:')
for (const file of execSync('find . -type f', { cwd: packageRoot })
  .toString()
  .split('\n')
  .filter(Boolean)
) {
  console.log(file)
}
const result = spawnSync(denoBin, args, {
  cwd: packageRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    DENO_DEPLOY_TOKEN: token,
    DENO_LOG: 'debug',
  },
})

if (result.error) {
  console.error('[deno-deploy]', result.error.message)
  process.exit(1)
}

process.exit(result.status ?? 1)
