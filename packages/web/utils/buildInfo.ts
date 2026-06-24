export type DeployTier = 'production' | 'beta' | 'staging' | 'development'

export interface BuildInfoInput {
  deployTier: string
  appVersion: string
  gitCommit: string
  gitRepoUrl: string
}

export function resolveDeployTier(raw: string | undefined): DeployTier {
  const value = (raw || 'development').trim().toLowerCase()
  if (value === 'production' || value === 'prod') return 'production'
  if (value === 'beta' || value === 'preproduction' || value === 'preprod') return 'beta'
  if (value === 'staging') return 'staging'
  return 'development'
}

export function shortCommit(sha: string): string {
  const normalized = sha.trim()
  if (!normalized) return 'unknown'
  return normalized.length > 7 ? normalized.slice(0, 7) : normalized
}

/** Human-readable version label baked into the admin footer. */
export function formatBuildLabel(info: BuildInfoInput): string {
  const tier = resolveDeployTier(info.deployTier)
  const version = info.appVersion.trim()

  switch (tier) {
    case 'production': {
      if (!version) return 'unknown'
      return version.startsWith('v') ? version : `v${version}`
    }
    case 'beta':
      return version || '0.0.0-dev'
    case 'staging':
      return shortCommit(info.gitCommit)
    default:
      return info.gitCommit ? `dev@${shortCommit(info.gitCommit)}` : 'dev'
  }
}

export function deployTierLabel(tier: DeployTier): string {
  switch (tier) {
    case 'production':
      return 'Production'
    case 'beta':
      return 'Beta'
    case 'staging':
      return 'Staging'
    default:
      return 'Development'
  }
}

export function commitPageUrl(repoUrl: string, sha: string): string | null {
  const commit = sha.trim()
  if (!commit || !repoUrl.trim()) return null
  const base = repoUrl.replace(/\.git$/, '').replace(/\/$/, '')
  return `${base}/commit/${commit}`
}

export function shouldLinkBuildLabel(tier: DeployTier): boolean {
  return tier === 'staging' || tier === 'development'
}
