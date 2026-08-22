import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isViteLocaleTransformNoise } from '../utils/sentryOptions';

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
