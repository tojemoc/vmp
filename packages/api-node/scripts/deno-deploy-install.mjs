/**
 * Deno Deploy install step for packages/api-node.
 *
 * Avoids root `npm ci` (fails on optional native platform packages in the
 * monorepo lockfile, e.g. @oxc-parser/binding-android-*) and avoids installing
 * the full Nuxt/Nx tree on the 3GB Deno builder.
 *
 * Workspace packages are resolved from sibling sources by scripts/build.mjs
 * aliases. `@vmp/storage` is a file: dependency so this package-local install
 * can link it without publishing.
 *
 * Sibling packages import npm deps (AWS SDK, Sentry) that live in this
 * package's node_modules — symlink that directory into each sibling so esbuild
 * can resolve them when bundling ../api and ../storage sources.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siblingNames = ['api', 'shared', 'storage', 'payments'];

for (const name of siblingNames) {
  const entry = path.join(packageRoot, '..', name, 'src', 'index.ts');
  if (!existsSync(entry)) {
    console.error(
      `[deno-deploy-install] Missing packages/${name} at ${entry}. ` +
        'Deno Deploy needs a full monorepo checkout (app directory = repo root, or ' +
        'packages/api-node with sibling packages present).',
    );
    console.error('[deno-deploy-install] packageRoot=', packageRoot);
    console.error('[deno-deploy-install] parent listing:');
    try {
      const { readdirSync } = await import('node:fs');
      console.error(readdirSync(path.join(packageRoot, '..')).join('\n'));
    } catch (err) {
      console.error(String(err));
    }
    process.exit(1);
  }
}

console.log('[deno-deploy-install] npm install --no-workspaces (package-local + file:../storage)');
const result = spawnSync(
  'npm',
  [
    'install',
    '--no-workspaces',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--no-package-lock',
  ],
  { cwd: packageRoot, stdio: 'inherit', env: process.env },
);

if ((result.status ?? 1) !== 0) {
  console.error('[deno-deploy-install] npm install failed');
  process.exit(result.status ?? 1);
}

const nodeModules = path.join(packageRoot, 'node_modules');
for (const name of siblingNames) {
  const linkPath = path.join(packageRoot, '..', name, 'node_modules');
  try {
    rmSync(linkPath, { recursive: true, force: true });
  } catch {
    // ignore
  }
  mkdirSync(path.dirname(linkPath), { recursive: true });
  symlinkSync(nodeModules, linkPath, 'dir');
  console.log(
    `[deno-deploy-install] linked packages/${name}/node_modules -> api-node/node_modules`,
  );
}

console.log('[deno-deploy-install] OK');
