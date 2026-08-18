import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { shouldResetSubscriptionIdentity } from '../utils/authSubscriptionIdentity';

describe('shouldResetSubscriptionIdentity', () => {
  it('does not reset when there was no prior identity', () => {
    assert.equal(
      shouldResetSubscriptionIdentity(null, {
        id: 'user-1',
        email: 'viewer@example.com',
      }),
      false,
    );
  });

  it('does not reset for the same user identity', () => {
    assert.equal(
      shouldResetSubscriptionIdentity(
        {
          id: 'user-1',
          email: 'viewer@example.com',
        },
        {
          id: 'user-1',
          email: 'viewer@example.com',
        },
      ),
      false,
    );
  });

  it('resets when the signed-in user changes', () => {
    assert.equal(
      shouldResetSubscriptionIdentity(
        {
          id: 'user-1',
          email: 'viewer@example.com',
        },
        {
          id: 'user-2',
          email: 'other@example.com',
        },
      ),
      true,
    );
  });
});
