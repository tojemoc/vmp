/**
 * packages/api/src/marketingConsent.ts
 *
 * Storage for explicit marketing (newsletter) consent. Membership on the Brevo
 * marketing list is driven only by this consent, never by billing status, so
 * that the platform keeps the promise made in its published personal data notice.
 *
 * This module holds no Brevo API code and imports nothing from brevo.ts, so it
 * stays a dependency leaf that brevo.ts can read the consent state from.
 */

/**
 * Version tag stored with each consent record. Bump when the personal data
 * notice wording that the opt-in refers to changes, so a re-consent is required.
 */
export const MARKETING_CONSENT_VERSION = '2026-09-01';

/** True when the user has an explicit, current marketing consent on record. */
export async function hasMarketingConsent(db: any, userId: any): Promise<boolean> {
  return !!(await readMarketingConsent(db, userId))?.consented;
}

/** Read the current consent state for a user, or null when the user is unknown. */
export async function readMarketingConsent(db: any, userId: any) {
  const row = await db
    .prepare(
      'SELECT marketing_consent_at, marketing_consent_version FROM users WHERE id = ? LIMIT 1',
    )
    .bind(userId)
    .first();
  if (!row) return null;
  return {
    consented: !!row.marketing_consent_at,
    consentedAt: row.marketing_consent_at ?? null,
    version: row.marketing_consent_version ?? null,
  };
}

/**
 * Grant or withdraw marketing consent. Granting stamps the current timestamp and
 * consent version; withdrawing clears both. Returns the new consent state, or
 * null when the user does not exist.
 */
export async function writeMarketingConsent(db: any, userId: any, consented: boolean) {
  if (consented) {
    await db
      .prepare(
        `UPDATE users
         SET marketing_consent_at = CURRENT_TIMESTAMP,
             marketing_consent_version = ?
         WHERE id = ?`,
      )
      .bind(MARKETING_CONSENT_VERSION, userId)
      .run();
  } else {
    await db
      .prepare(
        `UPDATE users
         SET marketing_consent_at = NULL,
             marketing_consent_version = NULL
         WHERE id = ?`,
      )
      .bind(userId)
      .run();
  }
  return readMarketingConsent(db, userId);
}
