/** How a video is ingested and published through Encore + packager. */

export type PipelineMode = 'fast_lane' | 'full_ladder'

export type PackagingStage = 'fast_lane_preview' | 'full_ladder'

/** Encode vs packager sub-step within a queued packaging stage. */
export type QueuedPipelineSubStage = 'encode' | 'package'

export function ingestLabelForMode(mode: PipelineMode): string {
  return mode === 'fast_lane' ? 'fast-lane' : 'full-ladder'
}

/** Map queued-packager stages to pipeline_watch PipelineStage for telemetry. */
export function packagingStageToPipelineStage(
  packagingStage: PackagingStage,
  subStage: QueuedPipelineSubStage,
): 'phase1_encode' | 'phase1_upload' | 'phase2_encode' | 'phase2_package' {
  if (packagingStage === 'fast_lane_preview') {
    return subStage === 'package' ? 'phase1_upload' : 'phase1_encode'
  }
  return subStage === 'package' ? 'phase2_package' : 'phase2_encode'
}
