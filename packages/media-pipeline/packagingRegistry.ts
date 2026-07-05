/**
 * In-process packaging job registry for encore-packager callbacks.
 * Used by supervisor; pipeline_watch polls /api/packaging/status/:jobId.
 */

import type { PackagingStage, PipelineMode } from './pipelineMode.js'

export type PackagingJobRecord = {
  jobId: string
  encoreJobUrl: string
  videoId: string
  stage: PackagingStage
  pipelineMode: PipelineMode
  status: 'pending' | 'success' | 'failed'
  outputPath?: string
  error?: string
  updatedAt: string
}

const jobs = new Map<string, PackagingJobRecord>()

export function registerPackagingJob(record: Omit<PackagingJobRecord, 'status' | 'updatedAt'>): PackagingJobRecord {
  const full: PackagingJobRecord = {
    ...record,
    status: 'pending',
    updatedAt: new Date().toISOString(),
  }
  jobs.set(record.jobId, full)
  return full
}

export function getPackagingJob(jobId: string): PackagingJobRecord | undefined {
  return jobs.get(jobId)
}

export function markPackagingSuccess(jobId: string, outputPath?: string): PackagingJobRecord | undefined {
  const existing = jobs.get(jobId)
  if (!existing) return undefined
  existing.status = 'success'
  existing.outputPath = outputPath
  existing.updatedAt = new Date().toISOString()
  return existing
}

export function markPackagingFailed(jobId: string, error: string): PackagingJobRecord | undefined {
  const existing = jobs.get(jobId)
  if (!existing) return undefined
  existing.status = 'failed'
  existing.error = error
  existing.updatedAt = new Date().toISOString()
  return existing
}

export function listPackagingJobs(): PackagingJobRecord[] {
  return [...jobs.values()]
}
