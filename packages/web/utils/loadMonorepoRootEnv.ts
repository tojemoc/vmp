import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadDotenv } from 'dotenv'

/**
 * Load repo-root `.env` into `process.env` when keys are not already set.
 *
 * `.env.example` lives at the monorepo root, but Nuxt only auto-loads
 * `packages/web/.env`. Without this, `NUXT_PUBLIC_UI_LOCALE` and other
 * shared vars copied to root `.env` are ignored during `nuxi dev` / `nuxi build`.
 */
export function loadMonorepoRootEnv(): void {
  const monorepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
  const rootEnvPath = resolve(monorepoRoot, '.env')
  if (!existsSync(rootEnvPath)) return

  const parsed = loadDotenv({ path: rootEnvPath, processEnv: {} }).parsed
  if (!parsed) return

  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}
