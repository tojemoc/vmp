import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

/**
 * Contract check for POST /api/auth/2fa/verify client wiring.
 * Env must be set before the client module evaluates `apiUrl`.
 */
process.env.EXPO_PUBLIC_API_URL = 'https://api.example.test';

describe('native TOTP API client contract', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('verifyNativeTotp posts code + pendingToken and requires refreshToken', async () => {
    let captured: { url: string; init: RequestInit } | null = null;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = { url: String(input), init: init || {} };
      return new Response(
        JSON.stringify({
          ok: true,
          accessToken: 'access',
          refreshToken: 'refresh',
          user: {
            id: 'u1',
            email: 'admin@example.com',
            role: 'admin',
            totpEnabled: true,
            totpRequired: true,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const { verifyNativeTotp } = await import('../src/api/client.ts');
    const session = await verifyNativeTotp('pending.jwt.here', '123456');

    assert.equal(captured?.url, 'https://api.example.test/api/auth/2fa/verify');
    assert.equal(captured?.init.method, 'POST');
    assert.deepEqual(JSON.parse(String(captured?.init.body)), {
      pendingToken: 'pending.jwt.here',
      code: '123456',
    });
    assert.equal(session.refreshToken, 'refresh');
    assert.equal(session.user.role, 'admin');
  });
});
