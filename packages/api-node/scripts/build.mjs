import * as esbuild from 'esbuild'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const apiEntry = path.join(packageRoot, '../api/src/index.ts')
const sharedEntry = path.join(packageRoot, '../shared/src/index.ts')
const storageRoot = path.join(packageRoot, '../storage/src')
const storageIndex = path.join(storageRoot, 'index.ts')
const storageNode = path.join(storageRoot, 'node.ts')
const storageWorker = path.join(storageRoot, 'worker.ts')

for (const required of [
  ['Worker sources', apiEntry],
  ['Shared types', sharedEntry],
  ['Storage package', storageIndex],
]) {
  if (!existsSync(required[1])) {
    throw new Error(
      `[build] Missing ${required[0]} at ${required[1]}. Deploy checkout must include packages/api, packages/shared, and packages/storage (esbuild bundles them into dist/).`,
    )
  }
}

mkdirSync('dist', { recursive: true })

await esbuild.build({
  entryPoints: ['src/server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outdir: 'dist',
  outExtension: { '.js': '.js' },
  packages: 'bundle',
  alias: {
    // CI can invoke api-node build without full workspace link metadata.
    // Resolve workspace packages to source directly; runtime npm dependencies are
    // bundled too so Deno Deploy does not need a package-local node_modules.
    // Prefer source over @vmp/storage package.json exports (which point at dist/).
    '@vmp/shared': sharedEntry,
    '@vmp/storage/node': storageNode,
    '@vmp/storage/worker': storageWorker,
    '@vmp/storage': storageIndex,
  },
  sourcemap: true,
  logLevel: 'info',
})

console.log('[build] api-node bundle complete')
