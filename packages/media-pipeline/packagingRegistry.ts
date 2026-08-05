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

const jobs = new Map<string, PackagingJobRecord>();

function evictOldestTerminal(status: 'success' | 'failed', max: number): void {
  const terminal = [...jobs.entries()]
    .filter(([, job]) => job.status === status)
    .sort((a, b) => a[1].updatedAt.localeCompare(b[1].updatedAt));
  while (terminal.length > max) {
    const oldest = terminal.shift();
    if (!oldest) break;
    jobs.delete(oldest[0]);
  }
}

function enforceRegistryRetention(): void {
  evictOldestTerminal('success', MAX_PACKAGING_SUCCESS_JOBS);
  evictOldestTerminal('failed', MAX_PACKAGING_FAILED_JOBS);
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
