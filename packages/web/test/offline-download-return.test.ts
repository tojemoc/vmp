import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  clearOfflineDownloadReturn,
  consumeOfflineDownloadReturn,
  markOfflineDownloadReturn,
} from '../utils/offlineDownloadReturn';

describe('offline download return intent', () => {
  const memory = new Map<string, string>();

  afterEach(() => {
    memory.clear();
    clearOfflineDownloadReturn();
  });

  const store = {
    getItem(key: string) {
      return memory.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      memory.set(key, value);
    },
    removeItem(key: string) {
      memory.delete(key);
    },
  };

  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: store,
  });

  it('consumes a matching recent intent once', () => {
    markOfflineDownloadReturn('vid-1');
    assert.equal(consumeOfflineDownloadReturn('vid-1'), true);
    assert.equal(consumeOfflineDownloadReturn('vid-1'), false);
  });

  it('ignores an intent for a different video', () => {
    markOfflineDownloadReturn('vid-1');
    assert.equal(consumeOfflineDownloadReturn('vid-2'), false);
  });

  it('ignores an expired intent', () => {
    markOfflineDownloadReturn('vid-1');
    assert.equal(consumeOfflineDownloadReturn('vid-1', Date.now() + 3 * 60 * 60 * 1000), false);
  });
});
