import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  APP_LINK_PATH_PREFIX,
  buildAppleAppSiteAssociation,
  buildAssetLinks,
  parseAndroidCertFingerprints,
  parseAppleAppIds,
} from '../utils/appLinksAssociation';

const FINGERPRINT_A =
  'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99';
const FINGERPRINT_B =
  '11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00';

describe('parseAndroidCertFingerprints', () => {
  it('accepts comma- and whitespace-separated lists', () => {
    assert.deepEqual(parseAndroidCertFingerprints(`${FINGERPRINT_A}, ${FINGERPRINT_B}`), [
      FINGERPRINT_A,
      FINGERPRINT_B,
    ]);
    assert.deepEqual(parseAndroidCertFingerprints(`${FINGERPRINT_A}\n${FINGERPRINT_B}`), [
      FINGERPRINT_A,
      FINGERPRINT_B,
    ]);
  });

  it('normalises case and de-duplicates', () => {
    assert.deepEqual(
      parseAndroidCertFingerprints(`${FINGERPRINT_A.toLowerCase()} ${FINGERPRINT_A}`),
      [FINGERPRINT_A],
    );
  });

  it('drops malformed entries so one typo cannot invalidate the file', () => {
    assert.deepEqual(parseAndroidCertFingerprints(`AA:BB:CC, ${FINGERPRINT_A}`), [FINGERPRINT_A]);
    assert.deepEqual(parseAndroidCertFingerprints('REPLACE_WITH_FINGERPRINT'), []);
    assert.deepEqual(parseAndroidCertFingerprints(''), []);
    assert.deepEqual(parseAndroidCertFingerprints(undefined), []);
  });
});

describe('parseAppleAppIds', () => {
  it('keeps well-formed team-qualified bundle ids', () => {
    assert.deepEqual(parseAppleAppIds('ABCDE12345.sk.tjm.vmp'), ['ABCDE12345.sk.tjm.vmp']);
  });

  it('rejects a bundle id with no team prefix and other junk', () => {
    assert.deepEqual(parseAppleAppIds('sk.tjm.vmp'), []);
    assert.deepEqual(parseAppleAppIds('REPLACE_WITH_TEAM_ID.sk.tjm.vmp'), []);
    assert.deepEqual(parseAppleAppIds(''), []);
  });
});

describe('buildAssetLinks', () => {
  it('emits the Digital Asset Links statement Google expects', () => {
    assert.deepEqual(buildAssetLinks('sk.tjm.vmp', [FINGERPRINT_A]), [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'sk.tjm.vmp',
          sha256_cert_fingerprints: [FINGERPRINT_A],
        },
      },
    ]);
  });

  it('serves nothing when unconfigured', () => {
    assert.equal(buildAssetLinks('sk.tjm.vmp', []), null);
    assert.equal(buildAssetLinks('', [FINGERPRINT_A]), null);
  });
});

describe('buildAppleAppSiteAssociation', () => {
  it('scopes the association to the magic-link path', () => {
    const association = buildAppleAppSiteAssociation(['ABCDE12345.sk.tjm.vmp']);
    assert.deepEqual(association?.applinks.details, [
      {
        appIDs: ['ABCDE12345.sk.tjm.vmp'],
        components: [{ '/': `${APP_LINK_PATH_PREFIX}*`, comment: 'Magic-link sign-in' }],
      },
    ]);
  });

  it('serves nothing when unconfigured', () => {
    assert.equal(buildAppleAppSiteAssociation([]), null);
  });
});
