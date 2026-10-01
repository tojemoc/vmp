import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatDoctorReport, runPipelineDoctor } from '../pipelineDoctor.js';

describe('pipelineDoctor', () => {
  it('fails fatally when packager secret missing or invalid charset', async () => {
    const report = await runPipelineDoctor({
      VMP_REQUIRE_WEBHOOK_SECRET: '0',
      VMP_UI_HOST: '127.0.0.1',
      VMP_PIPELINE_DOCTOR_SKIP_LIVE: '1',
      INBOX_FAST_LANE_DIR: '/tmp/vmp-doctor-fast',
      INBOX_FULL_LADDER_DIR: '/tmp/vmp-doctor-full',
      TMP_DIR_BASE: '/tmp/vmp-doctor-tmp',
      STORAGE_PROVIDER: 'b2',
      PACKAGE_OUTPUT_FOLDER: 's3://bucket/videos',
      S3_ENDPOINT_URL: 'https://s3.example.com',
      AWS_ACCESS_KEY_ID: 'k',
      AWS_SECRET_ACCESS_KEY: 's',
    });
    assert.equal(report.ok, false);
    assert.ok(report.findings.some((f) => f.id === 'packager.secret' && f.severity === 'fatal'));
  });

  it('rejects packager secrets with characters unsafe in Basic auth URLs', async () => {
    const report = await runPipelineDoctor({
      VMP_PACKAGER_SECRET: 'has/slash+plus',
      VMP_REQUIRE_WEBHOOK_SECRET: '0',
      VMP_UI_HOST: '127.0.0.1',
      VMP_PIPELINE_DOCTOR_SKIP_LIVE: '1',
      INBOX_FAST_LANE_DIR: '/tmp/vmp-doctor-fast2',
      INBOX_FULL_LADDER_DIR: '/tmp/vmp-doctor-full2',
      TMP_DIR_BASE: '/tmp/vmp-doctor-tmp2',
      STORAGE_PROVIDER: 'b2',
      PACKAGE_OUTPUT_FOLDER: 's3://bucket/videos',
      S3_ENDPOINT_URL: 'https://s3.example.com',
      AWS_ACCESS_KEY_ID: 'k',
      AWS_SECRET_ACCESS_KEY: 's',
    });
    const secret = report.findings.find((f) => f.id === 'packager.secret');
    assert.equal(secret?.severity, 'fatal');
    assert.match(formatDoctorReport(report), /Pipeline doctor: FAIL/);
  });
});
