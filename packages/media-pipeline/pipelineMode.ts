/** How a video is ingested and published through Encore + packager. */

export type PipelineMode = 'fast_lane' | 'full_ladder'

export type PackagingStage = 'fast_lane_preview' | 'full_ladder'

export function pipelineModeFromIngestSource(source: string): PipelineMode {
  if (source.includes('fast_lane') || source.includes('fast-lane')) return 'fast_lane'
  return 'full_ladder'
}

export function ingestLabelForMode(mode: PipelineMode): string {
  return mode === 'fast_lane' ? 'fast-lane' : 'full-ladder'
}
