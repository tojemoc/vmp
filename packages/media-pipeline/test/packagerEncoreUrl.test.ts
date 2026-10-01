import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isLoopbackEncoreUrl,
  rewriteEncoreJobUrlForPackager,
} from '../packagerEncoreUrl.js';

describe('packagerEncoreUrl', () => {
  it('detects loopback Encore URLs', () => {
    assert.equal(isLoopbackEncoreUrl('http://127.0.0.1:8080/encoreJobs/1'), true);
    assert.equal(isLoopbackEncoreUrl('http://localhost:8080/encoreJobs/1'), true);
    assert.equal(isLoopbackEncoreUrl('http://encore-web:8080/encoreJobs/1'), false);
  });

  it('rewrites loopback to encore-web when PACKAGER_ENCORE_BASE_URL unset', () => {
    const out = rewriteEncoreJobUrlForPackager(
      'http://127.0.0.1:8080/encoreJobs/abc',
      {},
    );
    assert.equal(out, 'http://encore-web:8080/encoreJobs/abc');
  });

  it('honors PACKAGER_ENCORE_BASE_URL', () => {
    const out = rewriteEncoreJobUrlForPackager('http://127.0.0.1:8080/encoreJobs/abc', {
      PACKAGER_ENCORE_BASE_URL: 'http://host.docker.internal:8080',
    });
    assert.equal(out, 'http://host.docker.internal:8080/encoreJobs/abc');
  });

  it('leaves docker-DNS URLs unchanged without override', () => {
    const url = 'http://encore-web:8080/encoreJobs/abc';
    assert.equal(rewriteEncoreJobUrlForPackager(url, {}), url);
  });
});
