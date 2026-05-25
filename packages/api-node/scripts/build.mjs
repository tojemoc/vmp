import * as esbuild from 'esbuild'
import { mkdirSync } from 'node:fs'

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
  external: ['better-sqlite3', '@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner'],
  sourcemap: true,
  logLevel: 'info',
})

console.log('[build] api-node bundle complete')
