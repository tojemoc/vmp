import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

process.env.EXPO_PUBLIC_API_URL = 'https://api.example.test';

describe('native magic-link OTP API client contract', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('verifyNativeMagicLinkCode posts email + code + client=native and requires refreshToken', async () => {
    const captured: { url: string; init: RequestInit } = { url: '', init: {} };

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.url = String(input);
      captured.init = init || {};
      return new Response(
        JSON.stringify({
          ok: true,
          accessToken: 'access',
          refreshToken: 'refresh',
          user: {
            id: 'u1',
            email: 'viewer@example.com',
            role: 'viewer',
            totpEnabled: false,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const { verifyNativeMagicLinkCode } = await import('../src/api/client');
    const session = await verifyNativeMagicLinkCode('viewer@example.com', '123456');

    assert.equal(captured.url, 'https://api.example.test/api/auth/verify-code');
    assert.equal(captured.init.method, 'POST');
    assert.deepEqual(JSON.parse(String(captured.init.body)), {
      email: 'viewer@example.com',
      code: '123456',
      client: 'native',
    });
    assert.ok(session && 'refreshToken' in session);
    assert.equal(session.refreshToken, 'refresh');
  });
});
