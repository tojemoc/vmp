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

  it('exposes gopay when configured and runnable', () => {
    assert.deepEqual(resolvePublicEnabledProviders(['stripe', 'gopay'], ['stripe', 'gopay']), [
      'stripe',
      'gopay',
    ]);
  });

  it('does not invent stripe when only stub providers remain after filtering', () => {
    const configured = parseProviderIdList('comgate', KNOWN);
    assert.deepEqual(configured, ['comgate']);
    assert.deepEqual(toSupportedApiProviderIds(configured), []);
    // Stubs are never runnable (isConfigured=false), so public list stays empty.
    assert.deepEqual(resolvePublicEnabledProviders(configured, []), []);
  });

  it('maps comgate stub to null; gopay is a public API id', () => {
    assert.equal(toApiProviderId('gopay'), 'gopay');
    assert.equal(toApiProviderId('comgate'), null);
  });

  it('excludes configured-but-not-runnable providers from public pricing', () => {
    assert.deepEqual(resolvePublicEnabledProviders(['stripe', 'qerko'], ['stripe']), ['stripe']);
    assert.deepEqual(resolvePublicEnabledProviders(['gopay'], []), []);
  });
});
