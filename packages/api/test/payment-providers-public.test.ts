import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseProviderIdList, type PaymentProviderId } from '@vmp/payments';
import {
  resolvePublicEnabledProviders,
  toApiProviderId,
  toSupportedApiProviderIds,
} from '../src/paymentProviders.js';

const KNOWN: PaymentProviderId[] = ['stripe', 'qerko', 'gopay', 'comgate'];

describe('resolvePublicEnabledProviders', () => {
  it('keeps stripe/legacy when they are configured and runnable', () => {
    assert.deepEqual(resolvePublicEnabledProviders(['stripe', 'qerko'], ['stripe', 'qerko']), [
      'stripe',
      'legacy',
    ]);
  });

  it('does not invent stripe when only stub providers remain after filtering', () => {
    const configured = parseProviderIdList('gopay,comgate', KNOWN);
    assert.deepEqual(configured, ['gopay', 'comgate']);
    assert.deepEqual(toSupportedApiProviderIds(configured), []);
    // Stubs are never runnable (isConfigured=false), so public list stays empty.
    assert.deepEqual(resolvePublicEnabledProviders(configured, []), []);
  });

  it('maps stub IDs to null instead of throwing', () => {
    assert.equal(toApiProviderId('gopay'), null);
    assert.equal(toApiProviderId('comgate'), null);
  });

  it('excludes configured-but-not-runnable providers from public pricing', () => {
    assert.deepEqual(resolvePublicEnabledProviders(['stripe', 'qerko'], ['stripe']), ['stripe']);
  });
});
