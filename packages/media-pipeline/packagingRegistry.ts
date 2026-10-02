/**
 * Packaging job registry for encore-packager callbacks.
 * In-memory L1 + Redis persistence so supervisor restarts do not lose in-flight jobs.
 */

import { createClient } from 'redis';
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

const REDIS_KEY_PREFIX = 'vmp:packaging:job:';
const REDIS_SUCCESS_TTL_SEC = 60 * 60 * 24;
const REDIS_FAILED_TTL_SEC = 60 * 60 * 72;
const REDIS_PENDING_TTL_SEC = 60 * 60 * 48;

const jobs = new Map<string, PackagingJobRecord>();

/** Concrete client type from default createClient() (RESP3 in redis@6). */
type PackagingRedisClient = ReturnType<typeof createRegistryClient>;

function createRegistryClient() {
  return createClient({
    url: (process.env.REDIS_URL || 'redis://127.0.0.1:6379').trim(),
    socket: { connectTimeout: 1500 },
  });
}

let redisClient: PackagingRedisClient | null = null;
let redisConnectPromise: Promise<PackagingRedisClient | null> | null = null;
let redisDisabled = false;

async function getRedis(): Promise<PackagingRedisClient | null> {
  if (redisDisabled || process.env.VMP_PACKAGING_REGISTRY_MEMORY_ONLY === '1') {
    return null;
  }
  if (redisClient?.isOpen) return redisClient;
  if (redisConnectPromise) return redisConnectPromise;

  redisConnectPromise = (async () => {
    try {
      const client = createRegistryClient();
      client.on('error', (err) => {
        process.stderr.write(
          `[packaging-registry] redis error: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      });
      await client.connect();
      redisClient = client;
      return client;
    } catch (err) {
      process.stderr.write(
        `[packaging-registry] redis unavailable, memory-only: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      redisDisabled = true;
      return null;
    } finally {
      redisConnectPromise = null;
    }
  })();

  return redisConnectPromise;
}

function redisKey(jobId: string): string {
  return `${REDIS_KEY_PREFIX}${jobId}`;
}

async function persistJob(record: PackagingJobRecord): Promise<void> {
  const client = await getRedis();
  if (!client) return;
  try {
    const ttl =
      record.status === 'success'
        ? REDIS_SUCCESS_TTL_SEC
        : record.status === 'failed'
          ? REDIS_FAILED_TTL_SEC
          : REDIS_PENDING_TTL_SEC;
    await client.set(redisKey(record.jobId), JSON.stringify(record), { EX: ttl });
  } catch (err) {
    process.stderr.write(
      `[packaging-registry] persist failed jobId=${record.jobId}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

async function loadJobFromRedis(jobId: string): Promise<PackagingJobRecord | undefined> {
  const client = await getRedis();
  if (!client) return undefined;
  try {
    const raw = await client.get(redisKey(jobId));
    if (!raw) return undefined;
    const text = typeof raw === 'string' ? raw : String(raw);
    const parsed = JSON.parse(text) as PackagingJobRecord;
    if (!parsed?.jobId || !parsed.status) return undefined;
    jobs.set(jobId, parsed);
    return parsed;
  } catch {
    return undefined;
  }
}

function evictOldestByStatus(status: PackagingJobRecord['status'], max: number): void {
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

export async function registerPackagingJob(
  record: Omit<PackagingJobRecord, 'status' | 'updatedAt'>,
): Promise<PackagingJobRecord> {
  const full: PackagingJobRecord = {
    ...record,
    status: 'pending',
    updatedAt: new Date().toISOString(),
  };
  jobs.set(record.jobId, full);
  enforceRegistryRetention();
  await persistJob(full);
  return full;
}

export async function getPackagingJob(jobId: string): Promise<PackagingJobRecord | undefined> {
  const cached = jobs.get(jobId);
  if (cached) return cached;
  return loadJobFromRedis(jobId);
}

export async function markPackagingSuccess(
  jobId: string,
  outputPath?: string,
): Promise<PackagingJobRecord | undefined> {
  let existing = jobs.get(jobId);
  if (!existing) existing = await loadJobFromRedis(jobId);
  if (!existing) return undefined;
  existing.status = 'success';
  existing.outputPath = outputPath;
  existing.updatedAt = new Date().toISOString();
  jobs.set(jobId, existing);
  enforceRegistryRetention();
  await persistJob(existing);
  return existing;
}

export async function markPackagingFailed(
  jobId: string,
  error: string,
): Promise<PackagingJobRecord | undefined> {
  let existing = jobs.get(jobId);
  if (!existing) existing = await loadJobFromRedis(jobId);
  if (!existing) return undefined;
  existing.status = 'failed';
  existing.error = error;
  existing.updatedAt = new Date().toISOString();
  jobs.set(jobId, existing);
  enforceRegistryRetention();
  await persistJob(existing);
  return existing;
}

export function listPackagingJobs(): PackagingJobRecord[] {
  return [...jobs.values()];
}

/** Test helper — reset in-memory + redis client state. */
export async function _resetPackagingRegistryForTests(): Promise<void> {
  jobs.clear();
  redisDisabled = false;
  if (redisClient?.isOpen) {
    try {
      await redisClient.quit();
    } catch {
      /* ignore */
    }
  }
  redisClient = null;
  redisConnectPromise = null;
}
