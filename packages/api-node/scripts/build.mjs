import * as esbuild from 'esbuild'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const apiEntry = path.join(packageRoot, '../api/src/index.ts')
const sharedEntry = path.join(packageRoot, '../shared/src/index.ts')

for (const required of [
  ['Worker sources', apiEntry],
  ['Shared types', sharedEntry],
]) {
  if (!existsSync(required[1])) {
    throw new Error(
      `[build] Missing ${required[0]} at ${required[1]}. Deploy checkout must include packages/api and packages/shared (esbuild bundles them into dist/).`,
    )
  }
}

mkdirSync('dist', { recursive: true })

await esbuild.build({
  entryPoints: ['src/server.ts', 'src/sync/d1sync-cli.ts', 'src/sync/write-log-export-cli.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outdir: 'dist',
  outExtension: { '.js': '.js' },
  packages: 'bundle',
  alias: {
    // CI can invoke api-node build without full workspace link metadata.
    // Resolve @vmp/shared to source directly so worker code can be bundled.
    '@vmp/shared': sharedEntry,
  },
  external: ['better-sqlite3', '@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner'],
  sourcemap: true,
  logLevel: 'info',
})

console.log('[build] api-node bundle complete')
