/** How a video is ingested and published through Encore + packager. */

export type PipelineMode = 'fast_lane' | 'full_ladder'

export type PackagingStage = 'fast_lane_preview' | 'full_ladder'

export function ingestLabelForMode(mode: PipelineMode): string {
  return mode === 'fast_lane' ? 'fast-lane' : 'full-ladder'
}

/** Map queued-packager stages to pipeline_watch PipelineStage for telemetry. */
export function packagingStageToPipelineStage(
  packagingStage: PackagingStage,
  detail?: string,
): 'phase1_encode' | 'phase1_upload' | 'phase2_encode' | 'phase2_package' {
  const isPackaging = detail?.includes('packaging') ?? false
  if (packagingStage === 'fast_lane_preview') {
    return isPackaging ? 'phase1_upload' : 'phase1_encode'
  }
  return isPackaging ? 'phase2_package' : 'phase2_encode'
}
