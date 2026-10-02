import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatDoctorReport,
  redactUrlCredentials,
  runPipelineDoctor,
} from '../pipelineDoctor.js';

describe('redactUrlCredentials', () => {
  it('masks userinfo and falls back for invalid URLs', () => {
    assert.equal(
      redactUrlCredentials('redis://user:s3cret@127.0.0.1:6379/0'),
      'redis://***:***@127.0.0.1:6379/0',
    );
    assert.equal(redactUrlCredentials('redis://127.0.0.1:6379'), 'redis://127.0.0.1:6379');
    assert.equal(redactUrlCredentials('not a url'), '[invalid-url]');
    assert.equal(redactUrlCredentials(''), '[empty-url]');
  });
});

describe('pipelineDoctor URL redaction', () => {
  it('redacts ENCORE_BASE_URL and S3 endpoint credentials in findings', async () => {
    const report = await runPipelineDoctor({
      VMP_PACKAGER_SECRET: 'valid-secret_ABC',
      VMP_REQUIRE_WEBHOOK_SECRET: '0',
      VMP_UI_HOST: '127.0.0.1',
      VMP_PIPELINE_DOCTOR_SKIP_LIVE: '1',
      ENCORE_BASE_URL: 'http://user:encore-secret@127.0.0.1:8080',
      INBOX_FAST_LANE_DIR: '/tmp/vmp-doctor-fast-redact',
      INBOX_FULL_LADDER_DIR: '/tmp/vmp-doctor-full-redact',
      TMP_DIR_BASE: '/tmp/vmp-doctor-tmp-redact',
      STORAGE_PROVIDER: 'b2',
      PACKAGE_OUTPUT_FOLDER: 's3://bucket/videos',
      S3_ENDPOINT_URL: 'https://key:endpoint-secret@s3.example.com',
      AWS_ACCESS_KEY_ID: 'k',
      AWS_SECRET_ACCESS_KEY: 's',
    });
    const encoreUrl = report.findings.find((f) => f.id === 'encore.url');
    const endpoint = report.findings.find((f) => f.id === 'storage.endpoint');
    assert.equal(encoreUrl?.severity, 'ok');
    assert.match(encoreUrl?.message ?? '', /ENCORE_BASE_URL=http:\/\/\*\*\*:\*\*\*@127\.0\.0\.1:8080\/?/);
    assert.doesNotMatch(encoreUrl?.message ?? '', /encore-secret/);
    assert.equal(endpoint?.severity, 'ok');
    assert.match(endpoint?.message ?? '', /S3 endpoint https:\/\/\*\*\*:\*\*\*@s3\.example\.com\/?/);
    assert.doesNotMatch(endpoint?.message ?? '', /endpoint-secret/);
  });
});

describe('pipelineDoctor', () => {
  it('fails fatally when PACKAGER_ENCORE_BASE_URL is malformed', async () => {
    const report = await runPipelineDoctor({
      VMP_PACKAGER_SECRET: 'valid-secret_ABC',
      VMP_REQUIRE_WEBHOOK_SECRET: '0',
      VMP_UI_HOST: '127.0.0.1',
      VMP_PIPELINE_DOCTOR_SKIP_LIVE: '1',
      PACKAGER_ENCORE_BASE_URL: 'http://user:super-secret@[bad',
      INBOX_FAST_LANE_DIR: '/tmp/vmp-doctor-fast-bad-url',
      INBOX_FULL_LADDER_DIR: '/tmp/vmp-doctor-full-bad-url',
      TMP_DIR_BASE: '/tmp/vmp-doctor-tmp-bad-url',
      STORAGE_PROVIDER: 'b2',
      PACKAGE_OUTPUT_FOLDER: 's3://bucket/videos',
      S3_ENDPOINT_URL: 'https://s3.example.com',
      AWS_ACCESS_KEY_ID: 'k',
      AWS_SECRET_ACCESS_KEY: 's',
    });
    assert.equal(report.ok, false);
    const packagerUrl = report.findings.find((f) => f.id === 'encore.packager_url');
    assert.equal(packagerUrl?.severity, 'fatal');
    assert.equal(packagerUrl?.message, 'Invalid PACKAGER_ENCORE_BASE_URL');
    assert.doesNotMatch(packagerUrl?.message ?? '', /super-secret/);
  });

  it('redacts credentials in valid PACKAGER_ENCORE_BASE_URL findings', async () => {
    const report = await runPipelineDoctor({
      VMP_PACKAGER_SECRET: 'valid-secret_ABC',
      VMP_REQUIRE_WEBHOOK_SECRET: '0',
      VMP_UI_HOST: '127.0.0.1',
      VMP_PIPELINE_DOCTOR_SKIP_LIVE: '1',
      PACKAGER_ENCORE_BASE_URL: 'user:super-secret@encore-web:8080',
      INBOX_FAST_LANE_DIR: '/tmp/vmp-doctor-fast-ok-url',
      INBOX_FULL_LADDER_DIR: '/tmp/vmp-doctor-full-ok-url',
      TMP_DIR_BASE: '/tmp/vmp-doctor-tmp-ok-url',
      STORAGE_PROVIDER: 'b2',
      PACKAGE_OUTPUT_FOLDER: 's3://bucket/videos',
      S3_ENDPOINT_URL: 'https://s3.example.com',
      AWS_ACCESS_KEY_ID: 'k',
      AWS_SECRET_ACCESS_KEY: 's',
    });
    const packagerUrl = report.findings.find((f) => f.id === 'encore.packager_url');
    assert.equal(packagerUrl?.severity, 'ok');
    assert.match(packagerUrl?.message ?? '', /PACKAGER_ENCORE_BASE_URL=http:\/\/\*\*\*:\*\*\*@encore-web:8080\/?/);
    assert.doesNotMatch(packagerUrl?.message ?? '', /super-secret/);
  });

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
