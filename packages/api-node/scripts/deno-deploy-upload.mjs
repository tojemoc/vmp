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
const packageDenoConfig = path.join(packageRoot, 'deno.json')
const baseArgs = [
  'deploy',
  '.',
  '--org',
  org,
  '--prod',
  '--allow-node-modules',
  '--config',
  packageDenoConfig,
]

const runDeploy = (appFlag) =>
  spawnSync(denoBin, [...baseArgs, appFlag, app], {
    cwd: packageRoot,
    stdio: 'inherit',
    env: { ...process.env, DENO_DEPLOY_TOKEN: token },
  })

// Current Deno Deploy CLI uses --app. Older releases accepted --project.
let result = runDeploy('--app')
if (result.status !== 0 && !result.error) {
  result = runDeploy('--project')
}

if (result.error) {
  console.error('[deno-deploy]', result.error.message)
  process.exit(1)
}

process.exit(result.status ?? 1)
