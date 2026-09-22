const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');
const fs = require('node:fs');

/**
 * Expo / Metro does not remap TypeScript ESM import specifiers ending in `.js`
 * to sibling `.ts` / `.tsx` sources (it looks for `foo.js.ts` instead of `foo.ts`).
 * `@vmp/shared` (and the rest of the monorepo) uses that NodeNext/bundler style,
 * so value imports from `@vmp/shared` fail at bundle time unless we remap here.
 *
 * Triggered by mobile CI after a runtime import of `@vmp/shared` (type-only imports
 * are erased and never hit the barrel re-exports).
 */
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

/**
 * @param {string} originModulePath
 * @param {string} moduleName
 * @returns {string | null}
 */
function remapJsSpecifierToTs(originModulePath, moduleName) {
  if (!moduleName.startsWith('.') || !moduleName.endsWith('.js')) {
    return null;
  }
  const base = moduleName.slice(0, -'.js'.length);
  const originDir = path.dirname(originModulePath);
  for (const ext of ['.ts', '.tsx']) {
    const abs = path.resolve(originDir, base + ext);
    if (fs.existsSync(abs)) {
      return base + ext;
    }
  }
  return null;
}

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const remapped = remapJsSpecifierToTs(context.originModulePath, moduleName);
  if (remapped) {
    return context.resolveRequest(context, remapped, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
