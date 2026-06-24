import {
  commitPageUrl,
  deployTierLabel,
  formatBuildLabel,
  resolveDeployTier,
  shouldLinkBuildLabel,
  type BuildInfoInput,
  type DeployTier,
} from '~/utils/buildInfo'

export function useBuildInfo() {
  const config = useRuntimeConfig()

  const input = computed<BuildInfoInput>(() => ({
    deployTier: String(config.public.deployTier ?? 'development'),
    appVersion: String(config.public.appVersion ?? ''),
    gitCommit: String(config.public.gitCommit ?? ''),
    gitRepoUrl: String(config.public.gitRepoUrl ?? 'https://github.com/tojemoc/vmp'),
  }))

  const tier = computed<DeployTier>(() => resolveDeployTier(input.value.deployTier))
  const label = computed(() => formatBuildLabel(input.value))
  const tierName = computed(() => deployTierLabel(tier.value))
  const gitCommit = computed(() => input.value.gitCommit)
  const commitUrl = computed(() => {
    if (!shouldLinkBuildLabel(tier.value)) return null
    return commitPageUrl(input.value.gitRepoUrl, input.value.gitCommit)
  })

  return {
    tier,
    tierName,
    label,
    gitCommit,
    commitUrl,
  }
}
