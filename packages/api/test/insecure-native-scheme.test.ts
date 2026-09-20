import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { INSECURE_NATIVE_SCHEME_CONFIRM_PHRASE } from '@vmp/shared';
import {
  handleAcknowledgeInsecureNativeScheme,
  handleInsecureNativeSchemeStatus,
  hashToken,
  isInsecureNativeVmpSchemeAllowed,
} from '../src/auth.js';

type MagicRow = {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  used_at: string | null;
};

type AckRow = {
  id: string;
  magic_link_token_hash: string;
  user_id: string;
  expires_at: string;
  user_agent: string | null;
  ip_hash: string | null;
};

class FakeAckDb {
  magicLinks: MagicRow[] = [];
  acks: AckRow[] = [];
  users = new Map<string, { id: string; email: string; role: string; totp_enabled: number }>();

  prepare(sql: string) {
    const db = this;
    const normalized = sql.replace(/\s+/g, ' ').trim();
    return {
      bind(...args: unknown[]) {
        return {
          async first() {
            if (normalized.includes('FROM magic_link_tokens t')) {
              const tokenHash = String(args[0]);
              const row = db.magicLinks.find((r) => r.token_hash === tokenHash);
              if (!row) return null;
              const user = db.users.get(row.user_id);
              if (!user) return null;
              return {
                id: row.id,
                expires_at: row.expires_at,
                used_at: row.used_at,
                user_id: user.id,
                email: user.email,
                role: user.role,
                totp_enabled: user.totp_enabled,
                totp_secret: null,
                created_at: '2026-01-01T00:00:00.000Z',
              };
            }
            return null;
          },
          async run() {
            if (normalized.includes('INSERT INTO insecure_native_scheme_acks')) {
              const [id, tokenHash, userId, expiresAt, userAgent, ipHash] = args as [
                string,
                string,
                string,
                string,
                string | null,
                string | null,
              ];
              const existing = db.acks.find((a) => a.magic_link_token_hash === tokenHash);
              if (existing) {
                existing.user_agent = userAgent;
                existing.ip_hash = ipHash;
                return { meta: { changes: 1 } };
              }
              db.acks.push({
                id,
                magic_link_token_hash: tokenHash,
                user_id: userId,
                expires_at: expiresAt,
                user_agent: userAgent,
                ip_hash: ipHash,
              });
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          },
        };
      },
    };
  }
}

function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('isInsecureNativeVmpSchemeAllowed', () => {
  it('is fail-closed unless flag is truthy and tier is not production/beta', () => {
    assert.equal(isInsecureNativeVmpSchemeAllowed({}), false);
    assert.equal(
      isInsecureNativeVmpSchemeAllowed({
        ALLOW_INSECURE_NATIVE_VMP_SCHEME: '1',
        SENTRY_ENVIRONMENT: 'production',
      }),
      false,
    );
    assert.equal(
      isInsecureNativeVmpSchemeAllowed({
        ALLOW_INSECURE_NATIVE_VMP_SCHEME: '1',
        SENTRY_ENVIRONMENT: 'beta',
      }),
      false,
    );
    assert.equal(
      isInsecureNativeVmpSchemeAllowed({
        ALLOW_INSECURE_NATIVE_VMP_SCHEME: '0',
        SENTRY_ENVIRONMENT: 'staging',
      }),
      false,
    );
    assert.equal(
      isInsecureNativeVmpSchemeAllowed({
        ALLOW_INSECURE_NATIVE_VMP_SCHEME: '1',
        SENTRY_ENVIRONMENT: 'staging',
      }),
      true,
    );
  });
});

describe('handleInsecureNativeSchemeStatus', () => {
  it('returns allowed + confirmPhrase only when the staging escape hatch is on', async () => {
    const denied = await handleInsecureNativeSchemeStatus(
      new Request('https://api.example/api/auth/native/insecure-scheme/status'),
      { SENTRY_ENVIRONMENT: 'staging', ALLOW_INSECURE_NATIVE_VMP_SCHEME: '0' },
      {},
    );
    assert.equal(denied.status, 200);
    const deniedBody = await denied.json();
    assert.equal(deniedBody.allowed, false);
    assert.equal(deniedBody.confirmPhrase, null);

    const allowed = await handleInsecureNativeSchemeStatus(
      new Request('https://api.example/api/auth/native/insecure-scheme/status'),
      { SENTRY_ENVIRONMENT: 'staging', ALLOW_INSECURE_NATIVE_VMP_SCHEME: '1' },
      {},
    );
    const allowedBody = await allowed.json();
    assert.equal(allowedBody.allowed, true);
    assert.equal(allowedBody.confirmPhrase, INSECURE_NATIVE_SCHEME_CONFIRM_PHRASE);
  });
});

describe('handleAcknowledgeInsecureNativeScheme', () => {
  it('rejects when the environment flag is off', async () => {
    const res = await handleAcknowledgeInsecureNativeScheme(
      jsonRequest('https://api.example/api/auth/native/insecure-scheme/acknowledge', {
        token: 'tok',
        acknowledgedRisk: true,
        doubleConfirmed: true,
        confirmPhrase: INSECURE_NATIVE_SCHEME_CONFIRM_PHRASE,
      }),
      { SENTRY_ENVIRONMENT: 'staging', ALLOW_INSECURE_NATIVE_VMP_SCHEME: '0', DB: new FakeAckDb() },
      {},
    );
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, 'insecure_scheme_disabled');
  });

  it('requires both risk flags and the exact confirm phrase', async () => {
    const db = new FakeAckDb();
    const env = {
      SENTRY_ENVIRONMENT: 'staging',
      ALLOW_INSECURE_NATIVE_VMP_SCHEME: '1',
      DB: db,
    };
    const incomplete = await handleAcknowledgeInsecureNativeScheme(
      jsonRequest('https://api.example/ack', {
        token: 'tok',
        acknowledgedRisk: true,
        doubleConfirmed: false,
        confirmPhrase: INSECURE_NATIVE_SCHEME_CONFIRM_PHRASE,
      }),
      env,
      {},
    );
    assert.equal(incomplete.status, 400);
    assert.equal((await incomplete.json()).code, 'ack_incomplete');

    const badPhrase = await handleAcknowledgeInsecureNativeScheme(
      jsonRequest('https://api.example/ack', {
        token: 'tok',
        acknowledgedRisk: true,
        doubleConfirmed: true,
        confirmPhrase: 'WRONG',
      }),
      env,
      {},
    );
    assert.equal(badPhrase.status, 400);
    assert.equal((await badPhrase.json()).code, 'ack_phrase_mismatch');
  });

  it('records a D1 acknowledgment bound to an unused magic-link token', async () => {
    const db = new FakeAckDb();
    const token = 'side-store-test-token';
    const tokenHash = await hashToken(token);
    db.users.set('user-1', {
      id: 'user-1',
      email: 'tester@example.com',
      role: 'viewer',
      totp_enabled: 0,
    });
    db.magicLinks.push({
      id: 'ml-1',
      user_id: 'user-1',
      token_hash: tokenHash,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      used_at: null,
    });

    const res = await handleAcknowledgeInsecureNativeScheme(
      jsonRequest(
        'https://api.example/ack',
        {
          token,
          acknowledgedRisk: true,
          doubleConfirmed: true,
          confirmPhrase: INSECURE_NATIVE_SCHEME_CONFIRM_PHRASE,
        },
        { 'CF-Connecting-IP': '203.0.113.10', 'User-Agent': 'Safari/SideStore-Test' },
      ),
      {
        SENTRY_ENVIRONMENT: 'staging',
        ALLOW_INSECURE_NATIVE_VMP_SCHEME: '1',
        DB: db,
      },
      {},
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.allowed, true);
    assert.equal(db.acks.length, 1);
    assert.equal(db.acks[0].magic_link_token_hash, tokenHash);
    assert.equal(db.acks[0].user_id, 'user-1');
    assert.equal(db.acks[0].user_agent, 'Safari/SideStore-Test');
    assert.ok(db.acks[0].ip_hash);
  });
});
