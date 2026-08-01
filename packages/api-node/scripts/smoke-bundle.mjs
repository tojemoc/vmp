/**
 * Smoke-test the esbuild bundle can load under Node (Deno Deploy warmup path).
 * Expects a clean failure for missing DATABASE_URL — not a module-init crash
 * (e.g. esbuild ESM "Dynamic require of node:https is not supported").
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const serverEntry = path.join(packageRoot, 'dist/server.js')

if (!existsSync(serverEntry)) {
  console.error('[smoke-bundle] missing dist/server.js — run npm run build first')
  process.exit(1)
}

const child = spawn(process.execPath, [serverEntry], {
  cwd: packageRoot,
  env: {
    ...process.env,
    // Force the expected missing-config path (do not inherit a local DATABASE_URL).
    DATABASE_URL: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let stdout = ''
let stderr = ''
child.stdout.on('data', (chunk) => {
  stdout += chunk
})
child.stderr.on('data', (chunk) => {
  stderr += chunk
})

const timeout = setTimeout(() => {
  child.kill('SIGKILL')
}, 10_000)

const exitCode = await new Promise((resolve) => {
  child.on('close', (code) => resolve(code ?? 1))
})
clearTimeout(timeout)

const combined = `${stdout}\n${stderr}`
if (/Dynamic require of ["']node:https["'] is not supported/i.test(combined)) {
  console.error(
    '[smoke-bundle] FAIL: bundle crashes on AWS SDK CJS require under ESM.\n' +
      'Fix packages/api-node/scripts/build.mjs (createRequire banner) and rebuild.\n' +
      combined,
  )
  process.exit(1)
}

if (!/DATABASE_URL is required/i.test(combined)) {
  console.error(
    '[smoke-bundle] FAIL: expected DATABASE_URL boot error; got exit ' +
      `${exitCode}\n${combined}`,
  )
  process.exit(1)
}

console.log('[smoke-bundle] OK: bundle loads; fails cleanly without DATABASE_URL')
process.exit(0)
