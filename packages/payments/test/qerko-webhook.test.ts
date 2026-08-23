import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseQerkoWebhookPayload } from '../src/providers/qerko/webhook.js';

describe('parseQerkoWebhookPayload', () => {
  it('maps nested subscription.cardOnFile to subscriptionId and idOrder to providerOrderId', () => {
    const event = parseQerkoWebhookPayload({
      purchaseId: 'cof-stable-123',
      idOrder: 'order-uuid-456',
      subscription: { cardOnFile: 'cof-stable-123' },
      status: 'active',
      planType: 'monthly',
    });

    assert.equal(event.type, 'subscription.updated');
    assert.equal(event.providerId, 'qerko');
    assert.equal(event.subscriptionId, 'cof-stable-123');
    assert.equal(event.purchaseId, 'cof-stable-123');
    assert.equal(event.providerOrderId, 'order-uuid-456');
  });

  it('maps cancelled status to subscription.deleted', () => {
    const event = parseQerkoWebhookPayload({
      purchaseId: 'cof-1',
      idOrder: 'order-1',
      subscription: { cardOnFile: 'cof-1' },
      status: 'cancelled',
    });

    assert.equal(event.type, 'subscription.deleted');
    assert.equal(event.status, 'cancelled');
  });

  it('maps past_due status to subscription.past_due', () => {
    const event = parseQerkoWebhookPayload({
      purchaseId: 'cof-1',
      idOrder: 'order-1',
      subscription: { cardOnFile: 'cof-1' },
      status: 'past_due',
    });

    assert.equal(event.type, 'subscription.past_due');
    assert.equal(event.status, 'past_due');
  });
});
