import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getObjectStorage, hasObjectStorage } from '../src/objectStorage.js';

describe('billing getObjectStorage', () => {
  it('uses private B2 when B2_* set (same rules as API playback storage)', () => {
    const storage = getObjectStorage({
      BUCKET: { get: async () => null } as any,
      B2_BUCKET_NAME: 'vmp-videos',
      B2_ACCESS_KEY_ID: 'key',
      B2_SECRET_ACCESS_KEY: 'secret',
      B2_S3_ENDPOINT: 'https://s3.eu-central-003.backblazeb2.com',
    });
    assert.ok(storage);
    assert.match(storage!.id, /b2/i);
    assert.equal(hasObjectStorage({ B2_BUCKET_NAME: 'x', B2_ACCESS_KEY_ID: 'k', B2_SECRET_ACCESS_KEY: 's' }), true);
  });

  it('falls back to R2 BUCKET binding for local Wrangler', () => {
    const storage = getObjectStorage({
      BUCKET: { get: async () => null } as any,
    });
    assert.ok(storage);
    assert.equal(storage!.id, 'r2');
  });

  it('returns undefined without B2 or R2', () => {
    assert.equal(getObjectStorage({}), undefined);
    assert.equal(hasObjectStorage({}), false);
  });
});
