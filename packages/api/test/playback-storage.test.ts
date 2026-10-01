import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createPlaybackStorage } from '../src/playbackStorage.js';

describe('createPlaybackStorage', () => {
  it('returns B2-only provider when B2 credentials are set (ignores R2 binding)', () => {
    const fakeBucket = { get: async () => null } as any;
    const storage = createPlaybackStorage({
      BUCKET: fakeBucket,
      B2_BUCKET_NAME: 'vmp-videos',
      B2_ACCESS_KEY_ID: 'key',
      B2_SECRET_ACCESS_KEY: 'secret',
      B2_REGION: 'eu-central-003',
      B2_S3_ENDPOINT: 'https://s3.eu-central-003.backblazeb2.com',
    });
    assert.ok(storage);
    assert.match(storage!.id, /b2/i);
  });

  it('falls back to R2 binding when B2 is unset (local Wrangler)', () => {
    const fakeBucket = { get: async () => null } as any;
    const storage = createPlaybackStorage({ BUCKET: fakeBucket });
    assert.ok(storage);
    assert.equal(storage!.id, 'r2');
  });

  it('returns undefined when neither B2 nor R2 binding is configured', () => {
    assert.equal(createPlaybackStorage({}), undefined);
  });
});
