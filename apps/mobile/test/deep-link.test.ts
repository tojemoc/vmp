import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { firstSearchParam, safeRedirectPath, tokenFromAuthUrl } from '../src/auth/deepLink';
import { shareInFlightByKey } from '../src/auth/inFlight';

const HOST = 'vmp.example';

describe('mobile deepLink helpers', () => {
  it('safeRedirectPath accepts same-app paths only', () => {
    assert.equal(safeRedirectPath('/watch/1'), '/watch/1');
    assert.equal(safeRedirectPath('/'), '/');
    assert.equal(safeRedirectPath('//evil.com'), '/');
    assert.equal(safeRedirectPath('https://evil.com'), '/');
    assert.equal(safeRedirectPath('../x'), '/');
    assert.equal(safeRedirectPath(undefined, '/login'), '/login');
  });

  it('firstSearchParam unwraps Expo Router arrays', () => {
    assert.equal(firstSearchParam('abc'), 'abc');
    assert.equal(firstSearchParam(['tok', 'other']), 'tok');
    assert.equal(firstSearchParam(undefined), '');
  });

  it('tokenFromAuthUrl reads https App Link tokens only for configured host + /auth/verify', () => {
    assert.equal(
      tokenFromAuthUrl(
        `https://${HOST}/auth/verify?token=abc%2B123&redirect=%2F`,
        false,
        HOST,
      ),
      'abc+123',
    );
    assert.equal(
      tokenFromAuthUrl(`https://evil.example/auth/verify?token=secret`, false, HOST),
      null,
    );
    assert.equal(
      tokenFromAuthUrl(`https://${HOST}/watch/1?token=secret`, false, HOST),
      null,
    );
    assert.equal(
      tokenFromAuthUrl(`https://${HOST}/auth/verify/extra?token=secret`, false, HOST),
      null,
    );
    assert.equal(
      tokenFromAuthUrl(`http://${HOST}/auth/verify?token=secret`, false, HOST),
      null,
    );
    assert.equal(
      tokenFromAuthUrl(`https://${HOST}/auth/verify?token=secret`, false, null),
      null,
    );
  });

  it('tokenFromAuthUrl gates vmp:// to exact auth/verify when allowed', () => {
    assert.equal(tokenFromAuthUrl('vmp://auth/verify?token=secret', false, HOST), null);
    assert.equal(tokenFromAuthUrl('vmp://auth/verify?token=secret', true, HOST), 'secret');
    assert.equal(tokenFromAuthUrl('vmp://other/verify?token=secret', true, HOST), null);
    assert.equal(tokenFromAuthUrl('vmp://auth/other?token=secret', true, HOST), null);
    assert.equal(tokenFromAuthUrl('vmp://auth/verify/extra?token=secret', true, HOST), null);
  });
});

describe('shareInFlightByKey', () => {
  it('reuses A across A/B/A interleaving while keeping B independent', async () => {
    const map = new Map<string, Promise<string>>();
    let aStarts = 0;
    let bStarts = 0;
    let resolveA!: (value: string) => void;
    let resolveB!: (value: string) => void;

    const pA1 = shareInFlightByKey(
      map,
      'A',
      () =>
        new Promise<string>((resolve) => {
          aStarts += 1;
          resolveA = resolve;
        }),
    );
    const pB = shareInFlightByKey(
      map,
      'B',
      () =>
        new Promise<string>((resolve) => {
          bStarts += 1;
          resolveB = resolve;
        }),
    );
    const pA2 = shareInFlightByKey(map, 'A', async () => {
      throw new Error('A work must not start again');
    });

    assert.equal(pA1, pA2);
    assert.notEqual(pA1, pB);
    // Work is deferred; starts are still 0 until the microtask queue runs.
    assert.equal(aStarts, 0);
    assert.equal(bStarts, 0);
    assert.equal(map.get('A'), pA1);
    assert.equal(map.get('B'), pB);

    await Promise.resolve();
    assert.equal(aStarts, 1);
    assert.equal(bStarts, 1);

    resolveB('B-done');
    assert.equal(await pB, 'B-done');

    resolveA('A-done');
    assert.equal(await pA1, 'A-done');
    assert.equal(await pA2, 'A-done');
    assert.equal(aStarts, 1);
  });

  it('stores the promise before work runs and allows retry after rejection', async () => {
    const map = new Map<string, Promise<string>>();
    let starts = 0;
    let sawSelfInMap = false;

    const failing = shareInFlightByKey(map, 'T', async () => {
      starts += 1;
      sawSelfInMap = map.get('T') === failing;
      throw new Error('boom');
    });

    assert.equal(map.get('T'), failing);
    assert.equal(starts, 0);

    await assert.rejects(failing, /boom/);
    assert.equal(sawSelfInMap, true);
    assert.equal(map.has('T'), false);

    const ok = shareInFlightByKey(map, 'T', async () => {
      starts += 1;
      return 'retry-ok';
    });
    assert.equal(await ok, 'retry-ok');
    assert.equal(starts, 2);
    assert.equal(map.has('T'), false);
  });
});
