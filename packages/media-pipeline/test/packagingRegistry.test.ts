import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  _resetPackagingRegistryForTests,
  getPackagingJob,
  markPackagingFailed,
  markPackagingSuccess,
  registerPackagingJob,
} from '../packagingRegistry.js';

describe('packagingRegistry (memory fallback)', () => {
  afterEach(async () => {
    await _resetPackagingRegistryForTests();
  });

  it('registers and retrieves pending jobs', async () => {
    process.env.VMP_PACKAGING_REGISTRY_MEMORY_ONLY = '1';
    await _resetPackagingRegistryForTests();
    const job = await registerPackagingJob({
      jobId: 'job-1',
      encoreJobUrl: 'http://encore-web:8080/encoreJobs/1',
      videoId: 'vid-1',
      stage: 'fast_lane_preview',
      pipelineMode: 'fast_lane',
    });
    assert.equal(job.status, 'pending');
    const got = await getPackagingJob('job-1');
    assert.ok(got);
    assert.equal(got?.videoId, 'vid-1');
  });

  it('marks success and failure', async () => {
    process.env.VMP_PACKAGING_REGISTRY_MEMORY_ONLY = '1';
    await _resetPackagingRegistryForTests();
    await registerPackagingJob({
      jobId: 'job-ok',
      encoreJobUrl: 'http://encore-web:8080/encoreJobs/2',
      videoId: 'vid-2',
      stage: 'full_ladder',
      pipelineMode: 'full_ladder',
    });
    await markPackagingSuccess('job-ok', 's3://bucket/videos/vid-2');
    const ok = await getPackagingJob('job-ok');
    assert.equal(ok?.status, 'success');
    assert.equal(ok?.outputPath, 's3://bucket/videos/vid-2');

    await registerPackagingJob({
      jobId: 'job-bad',
      encoreJobUrl: 'http://encore-web:8080/encoreJobs/3',
      videoId: 'vid-3',
      stage: 'full_ladder',
      pipelineMode: 'full_ladder',
    });
    await markPackagingFailed('job-bad', 'boom');
    const bad = await getPackagingJob('job-bad');
    assert.equal(bad?.status, 'failed');
    assert.equal(bad?.error, 'boom');
  });
});
