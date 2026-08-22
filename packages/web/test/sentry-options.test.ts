import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isDevEphemeralReferenceNoise,
  isViteLocaleTransformNoise,
} from '../utils/sentryOptions';

describe('isViteLocaleTransformNoise', () => {
  it('drops Vite locale transform failures from dev HMR', () => {
    assert.equal(
      isViteLocaleTransformNoise(
        '/locales/defineCatalog.ts — Transform failed with 1 error:',
      ),
      true,
    );
    assert.equal(
      isViteLocaleTransformNoise('/locales/en/strings.ts — Transform failed with 1 error:'),
      true,
    );
  });

  it('keeps unrelated production errors', () => {
    assert.equal(isViteLocaleTransformNoise('TypeError: Load failed'), false);
    assert.equal(isViteLocaleTransformNoise(undefined), false);
  });
});

describe('isDevEphemeralReferenceNoise', () => {
  it('drops bare INVALID ReferenceError from dev HMR edits', () => {
    assert.equal(isDevEphemeralReferenceNoise('INVALID is not defined'), true);
    assert.equal(isDevEphemeralReferenceNoise('Error: INVALID is not defined'), true);
  });

  it('keeps unrelated ReferenceErrors', () => {
    assert.equal(isDevEphemeralReferenceNoise('foo is not defined'), false);
    assert.equal(isDevEphemeralReferenceNoise(undefined), false);
  });
});
