/** Billing-side entitlement side-effect: revoke offline licenses on cancel. */

export async function revokeOfflineLicensesForUser(
  db: {
    prepare: (sql: string) => {
      bind: (...args: unknown[]) => { run: () => Promise<unknown> };
    };
  },
  userId: string,
  reason: string,
): Promise<void> {
  await db
    .prepare(`
    UPDATE offline_download_licenses
    SET status = 'revoked',
        revoked_at = CURRENT_TIMESTAMP,
        revoked_reason = ?
    WHERE user_id = ?
      AND status = 'active'
  `)
    .bind(reason, userId)
    .run();
}
