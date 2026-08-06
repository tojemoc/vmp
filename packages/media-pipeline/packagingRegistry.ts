/**
 * In-process packaging job registry for encore-packager callbacks.
 * Used by supervisor; pipeline_watch polls /api/packaging/status/:jobId.
 */

import type { PackagingStage, PipelineMode } from './pipelineMode.js';

export type PackagingJobRecord = {
  jobId: string;
  encoreJobUrl: string;
  videoId: string;
  stage: PackagingStage;
  pipelineMode: PipelineMode;
  status: 'pending' | 'success' | 'failed';
  outputPath?: string;
  error?: string;
  updatedAt: string;
};

/** Match supervisor MAX_PIPELINE_SUCCESS_JOBS retention. */
const MAX_PACKAGING_SUCCESS_JOBS = 400;
/** Match supervisor MAX_PIPELINE_FAILED_JOBS retention. */
const MAX_PACKAGING_FAILED_JOBS = 200;
/** Bound in-flight packaging records so orphaned pending jobs cannot grow without limit. */
const MAX_PACKAGING_PENDING_JOBS = 400;

const jobs = new Map<string, PackagingJobRecord>();

function evictOldestByStatus(
  status: PackagingJobRecord['status'],
  max: number,
): void {
  const matching = [...jobs.entries()]
    .filter(([, job]) => job.status === status)
    .sort((a, b) => a[1].updatedAt.localeCompare(b[1].updatedAt));
  while (matching.length > max) {
    const oldest = matching.shift();
    if (!oldest) break;
    jobs.delete(oldest[0]);
  }
}

function enforceRegistryRetention(): void {
  evictOldestByStatus('pending', MAX_PACKAGING_PENDING_JOBS);
  evictOldestByStatus('success', MAX_PACKAGING_SUCCESS_JOBS);
  evictOldestByStatus('failed', MAX_PACKAGING_FAILED_JOBS);
}

export function registerPackagingJob(
  record: Omit<PackagingJobRecord, 'status' | 'updatedAt'>,
): PackagingJobRecord {
  const full: PackagingJobRecord = {
    ...record,
    status: 'pending',
    updatedAt: new Date().toISOString(),
  };
  jobs.set(record.jobId, full);
  enforceRegistryRetention();
  return full;
}

export function getPackagingJob(jobId: string): PackagingJobRecord | undefined {
  return jobs.get(jobId);
}

export function markPackagingSuccess(
  jobId: string,
  outputPath?: string,
): PackagingJobRecord | undefined {
  const existing = jobs.get(jobId);
  if (!existing) return undefined;
  existing.status = 'success';
  existing.outputPath = outputPath;
  existing.updatedAt = new Date().toISOString();
  enforceRegistryRetention();
  return existing;
}

export function markPackagingFailed(jobId: string, error: string): PackagingJobRecord | undefined {
  const existing = jobs.get(jobId);
  if (!existing) return undefined;
  existing.status = 'failed';
  existing.error = error;
  existing.updatedAt = new Date().toISOString();
  enforceRegistryRetention();
  return existing;
}

export function listPackagingJobs(): PackagingJobRecord[] {
  return [...jobs.values()];
}
