#!/usr/bin/env node
/**
 * Upload a prebuilt api-node tree to Deno Deploy (GitHub Actions).
 * Expects dist/server.js in packages/api-node; runtime npm dependencies are bundled.
 * Set DENO_DEPLOY_DEBUG=true to print full tree/debug diagnostics.
 */

import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)

const entrypoint = path.join(packageRoot, 'dist/server.js')
const migrationsSource = path.join(packageRoot, '../api/migrations')
let stagingDir = ''

if (!existsSync(entrypoint)) {
  console.error(
    `[deno-deploy] Missing ${entrypoint}. Run npm run build first.`,
  )
  process.exit(1)
}

if (!existsSync(migrationsSource)) {
  console.error(
    `[deno-deploy] Missing migrations at ${migrationsSource}.`,
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

function prepareStagingDir() {
  stagingDir = mkdtempSync(path.join(tmpdir(), 'vmp-api-node-deploy-'))
  mkdirSync(stagingDir, { recursive: true })

  cpSync(entrypoint, path.join(stagingDir, 'server.js'))
  cpSync(migrationsSource, path.join(stagingDir, 'migrations'), { recursive: true })

  const stagingConfig = {
    name: '@vmp/api-node',
    version: '1.0.0',
    deploy: {
      org,
      app,
      runtime: {
        type: 'dynamic',
        entrypoint: './server.js',
      },
    },
    exports: {
      '.': './server.js',
    },
  }

  writeFileSync(
    path.join(stagingDir, 'deno.json'),
    `${JSON.stringify(stagingConfig, null, 2)}\n`,
  )
}

function cleanupStagingDir() {
  if (stagingDir) {
    rmSync(stagingDir, { recursive: true, force: true })
    stagingDir = ''
  }
}

prepareStagingDir()
process.on('exit', cleanupStagingDir)

const denoBin = process.env.DENO ?? 'deno'

const args = [
  'deploy',
  '.',
  '--org',
  org,
  '--app',
  app,
  '--prod',
  '--non-interactive',
]

console.log('[deno-deploy] Deploying prebuilt api-node bundle...')
console.log(`[deno-deploy] org=${org}`)
console.log(`[deno-deploy] app=${app}`)
console.log(`[deno-deploy] staging=${stagingDir}`)
console.log('[deno-deploy] entrypoint=./server.js (dynamic runtime)')
const debugEnabled = process.env.DENO_DEPLOY_DEBUG === 'true'

if (debugEnabled) {
  console.log('\n[deno-deploy] Staging tree:')
  console.log(execSync('find . -type f | sort', { cwd: stagingDir }).toString())
  console.log('\n[deno-deploy] CLI args:')
  console.log(JSON.stringify(args, null, 2))
} else {
  const stagedFiles = readdirSync(stagingDir, { recursive: true })
    .filter((entry) => typeof entry === 'string')
  console.log(`[deno-deploy] staged ${stagedFiles.length} top-level paths (server.js + migrations + deno.json)`)
}

const result = spawnSync(denoBin, args, {
  cwd: stagingDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    DENO_DEPLOY_TOKEN: token,
    DENO_LOG: debugEnabled ? 'debug' : process.env.DENO_LOG,
  },
})

cleanupStagingDir()

if (result.error) {
  console.error('[deno-deploy]', result.error.message)
  process.exit(1)
}

process.exit(result.status ?? 1)
