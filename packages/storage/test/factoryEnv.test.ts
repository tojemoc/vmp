import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bucketNameFromS3Uri, createStorageProviderFromEnv } from '../src/factory.js';

describe('bucketNameFromS3Uri', () => {
  it('parses PACKAGE_OUTPUT_FOLDER-style URIs', () => {
    assert.equal(bucketNameFromS3Uri('s3://vmp-videos/videos'), 'vmp-videos');
    assert.equal(bucketNameFromS3Uri('s3://my-b2-bucket'), 'my-b2-bucket');
    assert.equal(bucketNameFromS3Uri(''), undefined);
  });
});

describe('createStorageProviderFromEnv B2 aliases', () => {
  it('honors B2_BUCKET_NAME and S3_ENDPOINT_URL', () => {
    const provider = createStorageProviderFromEnv({
      STORAGE_PROVIDER: 'b2',
      B2_BUCKET_NAME: 'from-b2-bucket',
      B2_ACCESS_KEY_ID: 'key',
      B2_SECRET_ACCESS_KEY: 'secret',
      S3_ENDPOINT_URL: 'https://s3.eu-central-003.backblazeb2.com',
      B2_REGION: 'eu-central-003',
    });
    assert.equal(provider.id, 'b2');
  });

  it('falls back to PACKAGE_OUTPUT_FOLDER bucket when no bucket env set', () => {
    const provider = createStorageProviderFromEnv({
      STORAGE_PROVIDER: 'b2',
      PACKAGE_OUTPUT_FOLDER: 's3://packager-bucket/videos',
      AWS_ACCESS_KEY_ID: 'key',
      AWS_SECRET_ACCESS_KEY: 'secret',
      S3_ENDPOINT_URL: 'https://s3.eu-central-003.backblazeb2.com',
    });
    assert.equal(provider.id, 'b2');
  });
});
