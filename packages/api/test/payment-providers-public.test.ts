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

  it('exposes comgate when configured and runnable', () => {
    assert.deepEqual(
      resolvePublicEnabledProviders(['stripe', 'comgate'], ['stripe', 'comgate']),
      ['stripe', 'comgate'],
    );
  });

  it('does not invent stripe when no supported providers remain', () => {
    assert.deepEqual(resolvePublicEnabledProviders([], []), []);
  });

  it('maps all provider IDs correctly', () => {
    assert.equal(toApiProviderId('gopay'), 'gopay');
    assert.equal(toApiProviderId('comgate'), 'comgate');
    assert.equal(toApiProviderId('stripe'), 'stripe');
    assert.equal(toApiProviderId('qerko'), 'legacy');
  });

  it('excludes configured-but-not-runnable providers from public pricing', () => {
    assert.deepEqual(resolvePublicEnabledProviders(['stripe', 'qerko'], ['stripe']), ['stripe']);
    assert.deepEqual(resolvePublicEnabledProviders(['gopay'], []), []);
    assert.deepEqual(resolvePublicEnabledProviders(['comgate'], []), []);
  });
});
