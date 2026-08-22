import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cs } from '../locales/cs';
import { en } from '../locales/en';
import { sk } from '../locales/sk';
import type { StringsDefinition } from '../locales/types';

function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...flattenKeys(value as Record<string, unknown>, path));
    } else {
      keys.push(path);
    }
  }
  return keys.sort();
}

function smokeStrings(strings: StringsDefinition): void {
  strings.pwaLoginStepOf(1, 3);
  strings.moreInCategory(5);
  strings.previewOnly('1:30');
  strings.admin.slotEmpty(1);
}

describe('locale catalogs', () => {
  it('keeps en/sk/cs string keys in sync', () => {
    const enKeys = flattenKeys(en.strings as unknown as Record<string, unknown>);
    const skKeys = flattenKeys(sk.strings as unknown as Record<string, unknown>);
    const csKeys = flattenKeys(cs.strings as unknown as Record<string, unknown>);

    assert.deepEqual(skKeys, enKeys);
    assert.deepEqual(csKeys, enKeys);
  });

  it('exposes callable string helpers for each locale', () => {
    smokeStrings(en.strings);
    smokeStrings(sk.strings);
    smokeStrings(cs.strings);
  });
});
