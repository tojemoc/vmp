/**
 * packages/api/src/newsletterPreference.ts
 *
 * Paying-subscriber newsletter preference (opt-out model).
 *
 * Default: receive the creator newsletter while the subscription is active.
 * Opt-out only removes the contact from the Brevo marketing list. Transactional
 * / system messages (magic links, security, billing) use Brevo SMTP and are
 * never gated by this preference.
 *
 * Leaf module: no Brevo imports, so brevo.ts can read preference state safely.
 */

/** Version tag stored with each opt-out. Bump when related notice wording changes. */
export const NEWSLETTER_OPT_OUT_VERSION = '2026-09-04';

/** True when the user has explicitly opted out of the creator newsletter. */
export async function hasNewsletterOptOut(db: any, userId: any): Promise<boolean> {
  return !!(await readNewsletterPreference(db, userId))?.optedOut;
}

/** Read newsletter preference, or null when the user is unknown. */
export async function readNewsletterPreference(db: any, userId: any) {
  const row = await db
    .prepare(
      'SELECT newsletter_opted_out_at, newsletter_opt_out_version FROM users WHERE id = ? LIMIT 1',
    )
    .bind(userId)
    .first();
  if (!row) return null;
  return {
    optedOut: !!row.newsletter_opted_out_at,
    optedOutAt: row.newsletter_opted_out_at ?? null,
    version: row.newsletter_opt_out_version ?? null,
  };
}

/**
 * Set or clear newsletter opt-out. Opting out stamps timestamp + version;
 * clearing restores default (receive newsletter while paying). Returns the new
 * state, or null when the user does not exist.
 */
export async function writeNewsletterPreference(db: any, userId: any, optedOut: boolean) {
  if (optedOut) {
    await db
      .prepare(
        `UPDATE users
         SET newsletter_opted_out_at = CURRENT_TIMESTAMP,
             newsletter_opt_out_version = ?
         WHERE id = ?`,
      )
      .bind(NEWSLETTER_OPT_OUT_VERSION, userId)
      .run();
  } else {
    await db
      .prepare(
        `UPDATE users
         SET newsletter_opted_out_at = NULL,
             newsletter_opt_out_version = NULL
         WHERE id = ?`,
      )
      .bind(userId)
      .run();
  }
  return readNewsletterPreference(db, userId);
}

/**
 * Checkout may only *set* an opt-out. Omitted / false must not clear an existing
 * account-level opt-out — clearing stays an explicit account-preference action.
 */
export async function applyCheckoutNewsletterOptOut(
  db: any,
  userId: any,
  newsletterOptOut: boolean,
) {
  if (newsletterOptOut !== true) {
    return readNewsletterPreference(db, userId);
  }
  return writeNewsletterPreference(db, userId, true);
}
