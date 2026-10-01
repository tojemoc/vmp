import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createPrivateBucketStorage, isB2Configured } from '../src/privateBucket.js';

describe('createPrivateBucketStorage', () => {
  it('detects B2 configuration', () => {
    assert.equal(isB2Configured({}), false);
    assert.equal(
      isB2Configured({
        B2_BUCKET_NAME: 'vmp-videos',
        B2_ACCESS_KEY_ID: 'key',
        B2_SECRET_ACCESS_KEY: 'secret',
      }),
      true,
    );
  });

  it('prefers injectable STORAGE over B2 and R2', () => {
    const injected = { id: 'injected' } as any;
    const storage = createPrivateBucketStorage({
      STORAGE: injected,
      BUCKET: { get: async () => null } as any,
      B2_BUCKET_NAME: 'vmp-videos',
      B2_ACCESS_KEY_ID: 'key',
      B2_SECRET_ACCESS_KEY: 'secret',
    });
    assert.equal(storage, injected);
  });

  it('returns B2 when credentials are set (ignores R2 binding)', () => {
    const storage = createPrivateBucketStorage({
      BUCKET: { get: async () => null } as any,
      B2_BUCKET_NAME: 'vmp-videos',
      B2_ACCESS_KEY_ID: 'key',
      B2_SECRET_ACCESS_KEY: 'secret',
      B2_REGION: 'eu-central-003',
      B2_S3_ENDPOINT: 'https://s3.eu-central-003.backblazeb2.com',
    });
    assert.ok(storage);
    assert.match(storage!.id, /b2/i);
  });

  it('falls back to R2 binding when B2 unset', () => {
    const storage = createPrivateBucketStorage({
      BUCKET: { get: async () => null } as any,
    });
    assert.ok(storage);
    assert.equal(storage!.id, 'r2');
  });

  it('returns undefined when nothing configured', () => {
    assert.equal(createPrivateBucketStorage({}), undefined);
  });
});
