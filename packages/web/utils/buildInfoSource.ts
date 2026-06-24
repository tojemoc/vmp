import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Read build metadata at Nuxt config / CI build time (Node only). */
export function readBuildInfoDefaults() {
  const deployTier = process.env.NUXT_PUBLIC_DEPLOY_TIER || process.env.VMP_ENV || 'development'
  let appVersion = (process.env.NUXT_PUBLIC_APP_VERSION || '').trim()
  if (!appVersion) {
    try {
      const pkg = JSON.parse(readFileSync(join(webRoot, 'package.json'), 'utf8')) as { version?: string }
      appVersion = String(pkg.version ?? '0.0.0')
    } catch {
      appVersion = '0.0.0'
    }
  }

  let gitCommit = (process.env.NUXT_PUBLIC_GIT_COMMIT || process.env.GITHUB_SHA || '').trim()
  if (!gitCommit) {
    try {
      gitCommit = execSync('git rev-parse HEAD', { cwd: webRoot, encoding: 'utf8' }).trim()
    } catch {
      gitCommit = ''
    }
  }

  const gitRepoUrl = (process.env.NUXT_PUBLIC_GIT_REPO_URL || 'https://github.com/tojemoc/vmp').trim()

  return { deployTier, appVersion, gitCommit, gitRepoUrl }
}
