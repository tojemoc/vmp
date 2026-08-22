import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiEntry = path.join(packageRoot, '../api/src/index.ts');
const sharedEntry = path.join(packageRoot, '../shared/src/index.ts');
const paymentsEntry = path.join(packageRoot, '../payments/src/index.ts');
const storageRoot = path.join(packageRoot, '../storage/src');
const storageIndex = path.join(storageRoot, 'index.ts');
const storageNode = path.join(storageRoot, 'node.ts');
const storageWorker = path.join(storageRoot, 'worker.ts');

function readPackageJson(pkgPath) {
  return JSON.parse(readFileSync(pkgPath, 'utf8'));
}

/**
 * Deno Deploy installs only this package (`npm install --no-workspaces`).
 * Workspace `npm ci` hoists Worker deps, so GitHub's verify:api-node can
 * succeed even when a Worker npm dependency is missing here. Mirror every
 * non-workspace `@vmp/api` dependency in api-node package.json.
 */
function assertWorkerNpmDepsMirrored() {
  const apiPkg = readPackageJson(path.join(packageRoot, '../api/package.json'));
  const nodePkg = readPackageJson(path.join(packageRoot, 'package.json'));
  const installed = {
    ...nodePkg.dependencies,
    ...nodePkg.devDependencies,
  };
  const missing = Object.keys(apiPkg.dependencies ?? {}).filter(
    (dep) => !dep.startsWith('@vmp/') && !installed[dep],
  );
  if (missing.length > 0) {
    throw new Error(
      `[build] @vmp/api depends on ${missing.join(', ')}, but @vmp/api-node does not ` +
        'declare them. Deno Deploy package-local install cannot resolve Worker imports. ' +
        'Add the packages to packages/api-node/package.json.',
    );
  }
}

for (const required of [
  ['Worker sources', apiEntry],
  ['Shared types', sharedEntry],
  ['Payments package', paymentsEntry],
  ['Storage package', storageIndex],
]) {
  if (!existsSync(required[1])) {
    throw new Error(
      `[build] Missing ${required[0]} at ${required[1]}. Deploy checkout must include packages/api, packages/shared, packages/payments, and packages/storage (esbuild bundles them into dist/).`,
    );
  }
}

assertWorkerNpmDepsMirrored();

mkdirSync('dist', { recursive: true });

await esbuild.build({
  entryPoints: ['src/server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outdir: 'dist',
  outExtension: { '.js': '.js' },
  packages: 'bundle',
  // Sibling sources (../storage, ../api) resolve npm deps from this package's
  // node_modules during Deno Deploy's package-local install.
  nodePaths: [path.join(packageRoot, 'node_modules')],
  // AWS SDK / Smithy ship CJS that does `require('node:https')`. esbuild's default
  // ESM require shim throws ("Dynamic require … is not supported"), which breaks
  // Deno Deploy preview warmup. Provide a real createRequire for those calls.
  banner: {
    js: "import { createRequire as __apiNodeCreateRequire } from 'node:module'; const require = __apiNodeCreateRequire(import.meta.url);",
  },
  alias: {
    // CI / Deno Deploy can invoke this build without full workspace link metadata.
    // Resolve workspace packages to source directly; runtime npm dependencies are
    // bundled too so Deno Deploy does not need a package-local node_modules.
    // Prefer source over @vmp/storage package.json exports (which point at dist/).
    '@vmp/shared': sharedEntry,
    '@vmp/payments': paymentsEntry,
    '@vmp/storage/node': storageNode,
    '@vmp/storage/worker': storageWorker,
    '@vmp/storage': storageIndex,
  },
  sourcemap: true,
  logLevel: 'info',
});

console.log('[build] api-node bundle complete');
