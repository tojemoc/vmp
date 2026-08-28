import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { AuthUser } from '../composables/useAuth';
import type { PostHogIdentityClient } from '../utils/posthogBrowserClient';
import { syncPostHogIdentity } from '../utils/posthogIdentity';

function mockClient(): PostHogIdentityClient & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    __loaded: true,
    calls,
    setIdentity(distinctId, hash) {
      calls.push(`setIdentity:${distinctId}:${hash}`);
    },
    clearIdentity() {
      calls.push('clearIdentity');
    },
    identify(distinctId) {
      calls.push(`identify:${distinctId}`);
    },
    reset() {
      calls.push('reset');
    },
  };
}

const loggedInUser: AuthUser = {
  id: 'user_abc',
  email: 'u@example.com',
  role: 'viewer',
  totpEnabled: false,
  posthogIdentityHash: 'hash_abc',
};

describe('posthogIdentity', () => {
  it('sets Support identity for logged-in users without analytics consent', () => {
    const client = mockClient();
    const state = { supportUserId: null, analyticsUserId: null };

    syncPostHogIdentity(client, loggedInUser, false, state);

    assert.deepEqual(client.calls, ['setIdentity:user_abc:hash_abc']);
    assert.equal(state.supportUserId, 'user_abc');
    assert.equal(state.analyticsUserId, null);
  });

  it('identifies analytics user when consent is granted', () => {
    const client = mockClient();
    const state = { supportUserId: null, analyticsUserId: null };

    syncPostHogIdentity(client, loggedInUser, true, state);

    assert.deepEqual(client.calls, ['setIdentity:user_abc:hash_abc', 'identify:user_abc']);
    assert.equal(state.analyticsUserId, 'user_abc');
  });

  it('clears Support identity and resets analytics on logout', () => {
    const client = mockClient();
    const state = { supportUserId: 'user_abc', analyticsUserId: 'user_abc' };

    syncPostHogIdentity(client, null, true, state);

    assert.deepEqual(client.calls, ['reset', 'clearIdentity']);
    assert.equal(state.supportUserId, null);
    assert.equal(state.analyticsUserId, null);
  });

  it('re-applies Support identity after analytics reset on consent withdrawal', () => {
    const client = mockClient();
    const state = { supportUserId: 'user_abc', analyticsUserId: 'user_abc' };

    syncPostHogIdentity(client, loggedInUser, false, state);

    assert.deepEqual(client.calls, ['reset', 'setIdentity:user_abc:hash_abc']);
    assert.equal(state.supportUserId, 'user_abc');
    assert.equal(state.analyticsUserId, null);
  });
});
