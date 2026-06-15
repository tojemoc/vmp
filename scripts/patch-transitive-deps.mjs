/**
 * npm overrides cannot replace some nested transitive deps (e.g. miniflare → ws).
 * Align node_modules and package-lock.json with patched versions after install.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lockfilePath = join(root, 'package-lock.json');

const patches = [
  {
    label: 'miniflare/ws',
    nested: join(root, 'node_modules', 'miniflare', 'node_modules', 'ws'),
    version: '8.21.0',
    lockfile: {
      parentKey: 'node_modules/miniflare',
      nestedKey: 'node_modules/miniflare/node_modules/ws',
      hoistedKey: 'node_modules/ws',
    },
  },
];

function patchLockfile(patch, lockfile) {
  const parent = lockfile.packages[patch.lockfile.parentKey];
  const hoisted = lockfile.packages[patch.lockfile.hoistedKey];
  const nested = lockfile.packages[patch.lockfile.nestedKey];

  if (!parent?.dependencies?.ws || !hoisted || !nested) return false;
  if (parent.dependencies.ws === patch.version && nested.version === patch.version) {
    return false;
  }

  parent.dependencies.ws = patch.version;
  lockfile.packages[patch.lockfile.nestedKey] = {
    ...nested,
    version: hoisted.version,
    resolved: hoisted.resolved,
    integrity: hoisted.integrity,
  };
  return true;
}

let lockfileChanged = false;
if (existsSync(lockfilePath)) {
  const lockfile = JSON.parse(readFileSync(lockfilePath, 'utf8'));
  for (const patch of patches) {
    if (patchLockfile(patch, lockfile)) lockfileChanged = true;
  }
  if (lockfileChanged) {
    writeFileSync(lockfilePath, `${JSON.stringify(lockfile, null, 2)}\n`);
    console.log('[postinstall] Updated package-lock.json for patched transitive deps');
  }
}

for (const patch of patches) {
  if (!existsSync(patch.nested)) continue;

  const installed = JSON.parse(
    readFileSync(join(patch.nested, 'package.json'), 'utf8'),
  ).version;
  if (installed === patch.version) continue;

  console.log(`[postinstall] Patching ${patch.label}: ${installed} → ${patch.version}`);
  rmSync(patch.nested, { recursive: true, force: true });
}

if (lockfileChanged) {
  execSync('npm install', { cwd: root, stdio: 'inherit' });
  process.exit(0);
}

for (const patch of patches) {
  if (!existsSync(patch.nested)) continue;
  const installed = JSON.parse(
    readFileSync(join(patch.nested, 'package.json'), 'utf8'),
  ).version;
  if (installed !== patch.version) {
    throw new Error(`Failed to patch ${patch.label}; found ws@${installed}`);
  }
}
