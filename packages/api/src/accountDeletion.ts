/**
 * Self-service account deletion (roadmap step-10 / issue #646).
 *
 * POST /api/account/delete-request  — email a one-time confirmation token
 * POST /api/account/delete-confirm  — validate phrase + token, enqueue durable job
 * processAccountDeletionJobs        — scheduled worker (retry-safe steps)
 */

import { ACCOUNT_DELETION_CONFIRM_PHRASE } from '@vmp/shared';
import { generateToken, hashToken, requireAuth } from './auth.js';
import { deleteBrevoContactByEmail } from './brevo.js';
import { getObjectStorage } from './objectStorage.js';
import { getPaymentProviders } from './paymentProviders.js';

const DELETION_TOKEN_TTL_SEC = 15 * 60;
const CONFIRM_PHRASE = ACCOUNT_DELETION_CONFIRM_PHRASE;

type JobRow = {
  id: string;
  user_id: string | null;
  brevo_contact_identifier: string | null;
  status: string;
  subscription_cancelled: number;
  einvoices_anonymized: number;
  r2_sanitized: number;
  db_cleaned: number;
  brevo_deleted: number;
  user_deleted: number;
  error_message: string | null;
};

function getDb(env: any) {
  const db = env.DB || env.video_subscription_db;
  if (!db) throw new Error('D1 binding not found');
  return db;
}

function jsonResponse(data: unknown, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...corsHeaders,
    },
  });
}

function newId(): string {
  return crypto.randomUUID();
}

async function sendDeletionEmail(to: string, confirmUrl: string, env: any) {
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'api-key': env.BREVO_API_KEY,
    },
    body: JSON.stringify({
      sender: {
        email: env.SENDER_EMAIL || 'noreply@example.com',
        name: env.SENDER_NAME || 'VMP',
      },
      to: [{ email: to }],
      subject: 'Confirm account deletion',
      htmlContent: `<p>You requested deletion of your account.</p>
<p><a href="${confirmUrl}">Confirm deletion</a> (link expires in 15 minutes).</p>
<p>You must be signed in as this account, then type <strong>${CONFIRM_PHRASE}</strong> to finish.</p>
<p>Anonymized invoice records are retained for the statutory accounting period.</p>
<p>If you did not request this, ignore this email.</p>`,
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Brevo deletion email failed (${response.status}): ${body}`);
  }
}

/**
 * POST /api/account/delete-request
 */
export async function handleAccountDeleteRequest(request: any, env: any, corsHeaders: any) {
  let user: { sub: string; email?: string };
  try {
    user = await requireAuth(request, env);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unauthorized';
    return jsonResponse({ error: msg }, 401, corsHeaders);
  }

  const db = getDb(env);
  const emailRow = await db
    .prepare('SELECT email, deletion_pending FROM users WHERE id = ? LIMIT 1')
    .bind(user.sub)
    .first();
  if (!emailRow) {
    return jsonResponse({ error: 'User no longer exists', code: 'user_gone' }, 401, corsHeaders);
  }
  if (Number(emailRow.deletion_pending) === 1) {
    return jsonResponse(
      { error: 'Account deletion already in progress', code: 'deletion_pending' },
      409,
      corsHeaders,
    );
  }

  const rawToken = generateToken();
  const tokenHash = await hashToken(rawToken);
  const tokenId = newId();
  const expiresAt = new Date(Date.now() + DELETION_TOKEN_TTL_SEC * 1000).toISOString();

  // Invalidate unused prior tokens for this user.
  await db
    .prepare(
      'UPDATE account_deletion_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND used_at IS NULL',
    )
    .bind(user.sub)
    .run();

  await db
    .prepare(
      `INSERT INTO account_deletion_tokens (id, user_id, token_hash, expires_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(tokenId, user.sub, tokenHash, expiresAt)
    .run();

  const frontendUrl = String(env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
  const confirmUrl = `${frontendUrl}/account?delete_token=${encodeURIComponent(rawToken)}#delete-account`;

  const email = String(emailRow.email || user.email || '').trim();
  if (env.BREVO_API_KEY && email) {
    await sendDeletionEmail(email, confirmUrl, env);
  } else {
    console.log(`[DEV] Account deletion confirm URL for ${email || user.sub}: ${confirmUrl}`);
  }

  return jsonResponse({ ok: true, expiresAt }, 200, corsHeaders);
}

async function providerSupportsImmediateCancel(
  env: any,
  providerId: string | null | undefined,
): Promise<boolean> {
  if (!providerId) return true; // no external sub to cancel
  const { providers } = await getPaymentProviders(env);
  const provider = providers.get(providerId as any);
  if (!provider) return false;
  return provider.capabilities.immediateCancellation === true;
}

/**
 * POST /api/account/delete-confirm
 * Body: { token: string, confirmationPhrase: string }
 */
export async function handleAccountDeleteConfirm(request: any, env: any, corsHeaders: any) {
  let user: { sub: string; email?: string };
  try {
    user = await requireAuth(request, env);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unauthorized';
    return jsonResponse({ error: msg }, 401, corsHeaders);
  }

  const body = await request.json().catch(() => null);
  const rawToken = typeof body?.token === 'string' ? body.token.trim() : '';
  const phrase = typeof body?.confirmationPhrase === 'string' ? body.confirmationPhrase.trim() : '';

  if (!rawToken) {
    return jsonResponse({ error: 'token is required', code: 'token_required' }, 400, corsHeaders);
  }
  if (phrase !== CONFIRM_PHRASE) {
    return jsonResponse(
      {
        error: `Confirmation phrase must be exactly: ${CONFIRM_PHRASE}`,
        code: 'phrase_mismatch',
      },
      400,
      corsHeaders,
    );
  }

  const db = getDb(env);
  const tokenHash = await hashToken(rawToken);
  const tokenRow = await db
    .prepare(
      `SELECT id, user_id, expires_at, used_at
       FROM account_deletion_tokens
       WHERE token_hash = ?
       LIMIT 1`,
    )
    .bind(tokenHash)
    .first();

  if (!tokenRow || tokenRow.used_at) {
    return jsonResponse(
      { error: 'Deletion link is invalid or has already been used', code: 'token_invalid' },
      401,
      corsHeaders,
    );
  }
  if (String(tokenRow.user_id) !== String(user.sub)) {
    return jsonResponse(
      {
        error: 'Deletion link does not match the signed-in account',
        code: 'token_subject_mismatch',
      },
      403,
      corsHeaders,
    );
  }
  if (new Date(String(tokenRow.expires_at)) < new Date()) {
    return jsonResponse(
      { error: 'Deletion link has expired. Request a new one.', code: 'token_expired' },
      401,
      corsHeaders,
    );
  }

  const userRow = await db
    .prepare('SELECT id, email, deletion_pending FROM users WHERE id = ? LIMIT 1')
    .bind(user.sub)
    .first();
  if (!userRow) {
    return jsonResponse({ error: 'User no longer exists', code: 'user_gone' }, 401, corsHeaders);
  }
  if (Number(userRow.deletion_pending) === 1) {
    const existing = await db
      .prepare(
        `SELECT id, status FROM account_deletion_jobs
         WHERE user_id = ? AND status IN ('pending', 'running', 'blocked', 'brevo_failed')
         ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(user.sub)
      .first();
    return jsonResponse(
      {
        ok: true,
        jobId: existing?.id ?? null,
        status: existing?.status ?? 'pending',
        code: 'already_pending',
      },
      200,
      corsHeaders,
    );
  }

  // Active subscription: require immediate-cancel support before locking the account.
  const sub = await db
    .prepare(
      `SELECT id, provider, provider_subscription_id, stripe_subscription_id, status
       FROM subscriptions
       WHERE user_id = ?
         AND status IN ('active', 'trialing', 'past_due')
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .bind(user.sub)
    .first();

  if (sub) {
    const providerId = String(sub.provider || 'stripe').trim() || 'stripe';
    const supported = await providerSupportsImmediateCancel(env, providerId);
    if (!supported) {
      return jsonResponse(
        {
          error:
            'Your payment provider cannot cancel immediately. Account deletion is blocked until immediate cancellation is supported.',
          code: 'immediate_cancel_unsupported',
          provider: providerId,
        },
        409,
        corsHeaders,
      );
    }
  }

  const jobId = newId();
  const brevoId = String(userRow.email || '')
    .trim()
    .toLowerCase();

  // Atomic: consume token + create job + mark deletion_pending.
  // A crash must not leave used_at set without a job row.
  await db.batch([
    db
      .prepare(
        `UPDATE account_deletion_tokens
         SET used_at = CURRENT_TIMESTAMP
         WHERE id = ? AND used_at IS NULL`,
      )
      .bind(tokenRow.id),
    db
      .prepare(
        `INSERT INTO account_deletion_jobs (
           id, user_id, brevo_contact_identifier, status, updated_at
         ) VALUES (?, ?, ?, 'pending', CURRENT_TIMESTAMP)`,
      )
      .bind(jobId, user.sub, brevoId || null),
    db.prepare('UPDATE users SET deletion_pending = 1 WHERE id = ?').bind(user.sub),
  ]);

  // Kick off processing (best-effort); scheduled handler retries.
  try {
    await processAccountDeletionJob(env, jobId);
  } catch (err) {
    console.error(
      '[account-deletion] immediate process failed',
      err instanceof Error ? err.message : String(err),
    );
  }

  return jsonResponse({ ok: true, jobId, status: 'pending' }, 200, corsHeaders);
}

async function loadJob(db: any, jobId: string): Promise<JobRow | null> {
  return db
    .prepare(
      `SELECT id, user_id, brevo_contact_identifier, status,
              subscription_cancelled, einvoices_anonymized, r2_sanitized,
              db_cleaned, brevo_deleted, user_deleted, error_message
       FROM account_deletion_jobs WHERE id = ? LIMIT 1`,
    )
    .bind(jobId)
    .first();
}

async function markJob(
  db: any,
  jobId: string,
  fields: Record<string, string | number | null>,
): Promise<void> {
  const sets: string[] = ['updated_at = CURRENT_TIMESTAMP'];
  const binds: unknown[] = [];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`);
    binds.push(v);
  }
  binds.push(jobId);
  await db
    .prepare(`UPDATE account_deletion_jobs SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();
}

async function cancelSubscriptionForUser(env: any, userId: string): Promise<void> {
  const db = getDb(env);
  const subs = await db
    .prepare(
      `SELECT id, provider, provider_subscription_id, stripe_subscription_id, status
       FROM subscriptions
       WHERE user_id = ?
         AND status IN ('active', 'trialing', 'past_due')`,
    )
    .bind(userId)
    .all();

  const rows = subs?.results ?? [];
  if (!rows.length) return;

  const { providers } = await getPaymentProviders(env);
  for (const row of rows) {
    const providerId = String(row.provider || 'stripe').trim() || 'stripe';
    const provider = providers.get(providerId as any);
    const subId =
      String(row.provider_subscription_id || '').trim() ||
      String(row.stripe_subscription_id || '').trim();
    if (provider && subId && provider.capabilities.immediateCancellation) {
      await provider.cancelSubscriptionImmediately(subId);
    } else if (subId && provider) {
      const err = new Error(`Provider ${providerId} does not support immediate cancellation`);
      Object.assign(err, { code: 'immediate_cancel_unsupported' });
      throw err;
    }
    await db
      .prepare(
        `UPDATE subscriptions
         SET status = 'cancelled', cancel_at_period_end = 0, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(row.id)
      .run();
  }
}

async function inventoryR2Objects(db: any, jobId: string, userId: string): Promise<void> {
  const invoices = await db
    .prepare(
      `SELECT xml_payload_r2_key, pdf_payload_r2_key
       FROM einvoices WHERE user_id = ?`,
    )
    .bind(userId)
    .all();
  const rows = invoices?.results ?? [];
  const stmts: any[] = [];
  for (const inv of rows) {
    for (const key of [inv.xml_payload_r2_key, inv.pdf_payload_r2_key]) {
      const objectKey = typeof key === 'string' ? key.trim() : '';
      if (!objectKey) continue;
      stmts.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO account_deletion_r2_objects (id, job_id, object_key)
             VALUES (?, ?, ?)`,
          )
          .bind(newId(), jobId, objectKey),
      );
    }
  }
  if (stmts.length) await db.batch(stmts);
}

/**
 * Replace invoice R2 payloads with a sanitized archival stub (buyer PII removed).
 * If storage is unavailable, mark `retained_under_policy` so the job can proceed
 * under documented lawful retention with access controls on the original object.
 */
async function sanitizeR2Objects(env: any, jobId: string): Promise<void> {
  const db = getDb(env);
  const pending = await db
    .prepare(
      `SELECT id, object_key FROM account_deletion_r2_objects
       WHERE job_id = ? AND (outcome IS NULL OR outcome = '')`,
    )
    .bind(jobId)
    .all();
  const rows = pending?.results ?? [];
  const storage = getObjectStorage(env);

  for (const row of rows) {
    const objectKey = String(row.object_key);
    let outcome: 'sanitized' | 'retained_under_policy' = 'retained_under_policy';
    if (storage) {
      try {
        const stub = JSON.stringify({
          sanitized: true,
          reason: 'account_deletion_gdpr_art17_3_b_retention',
          note: 'Buyer PII removed; amounts/dates retained in D1 einvoices row.',
          originalKey: objectKey,
        });
        await storage.putObject(objectKey, stub, { contentType: 'application/json' });
        outcome = 'sanitized';
      } catch (err) {
        console.warn(
          '[account-deletion] R2 sanitize failed; retaining under policy',
          objectKey,
          err instanceof Error ? err.message : String(err),
        );
        outcome = 'retained_under_policy';
      }
    }
    await db
      .prepare(
        `UPDATE account_deletion_r2_objects
         SET outcome = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(outcome, row.id)
      .run();
  }

  const unresolved = await db
    .prepare(
      `SELECT 1 AS ok FROM account_deletion_r2_objects
       WHERE job_id = ? AND (outcome IS NULL OR outcome = '')
       LIMIT 1`,
    )
    .bind(jobId)
    .first();
  if (!unresolved) {
    await markJob(db, jobId, { r2_sanitized: 1 });
  }
}

async function anonymizeEinvoicesAndDeleteUser(db: any, jobId: string, userId: string) {
  // Inventory must already be persisted before this batch.
  await db.batch([
    db
      .prepare(
        `UPDATE einvoices SET
           buyer_name = NULL,
           buyer_email = NULL,
           buyer_address_json = NULL,
           buyer_vat_id = NULL,
           buyer_peppol_endpoint_id = NULL,
           buyer_peppol_scheme_id = NULL,
           updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ?`,
      )
      .bind(userId),
    db.prepare('DELETE FROM users WHERE id = ?').bind(userId),
    db
      .prepare(
        `UPDATE account_deletion_jobs SET
           einvoices_anonymized = 1,
           db_cleaned = 1,
           user_deleted = 1,
           user_id = NULL,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(jobId),
  ]);
}

/**
 * Process a single deletion job. Safe to retry; skips completed steps.
 */
export async function processAccountDeletionJob(env: any, jobId: string): Promise<void> {
  const db = getDb(env);
  let job = await loadJob(db, jobId);
  if (!job) return;
  if (job.status === 'completed') return;
  if (job.status === 'brevo_failed' || job.status === 'blocked') {
    // Terminal until operator remediation — still allow brevo retry via processAccountDeletionJobs force.
  }

  await markJob(db, jobId, { status: 'running', error_message: null });

  try {
    // 1) Cancel subscription (needs user_id)
    if (!job.subscription_cancelled) {
      if (!job.user_id) {
        await markJob(db, jobId, { subscription_cancelled: 1 });
      } else {
        await cancelSubscriptionForUser(env, job.user_id);
        await markJob(db, jobId, { subscription_cancelled: 1 });
      }
      job = (await loadJob(db, jobId))!;
    }

    // 2) Inventory R2 keys before cleanup
    if (job.user_id && !job.r2_sanitized) {
      await inventoryR2Objects(db, jobId, job.user_id);
    }

    // 3) Sanitize R2 (may run before or after user delete; inventory is job-keyed)
    if (!job.r2_sanitized) {
      await sanitizeR2Objects(env, jobId);
      job = (await loadJob(db, jobId))!;
    }

    // 4) Anonymize invoices + delete user
    if (!job.user_deleted && job.user_id) {
      await anonymizeEinvoicesAndDeleteUser(db, jobId, job.user_id);
      job = (await loadJob(db, jobId))!;
    } else if (!job.user_deleted && !job.user_id) {
      await markJob(db, jobId, {
        einvoices_anonymized: 1,
        db_cleaned: 1,
        user_deleted: 1,
      });
      job = (await loadJob(db, jobId))!;
    }

    // 5) Brevo contact deletion (uses persisted identifier)
    if (!job.brevo_deleted) {
      if (!env.BREVO_API_KEY) {
        await markJob(db, jobId, { brevo_deleted: 1 });
      } else if (!job.brevo_contact_identifier) {
        await markJob(db, jobId, { brevo_deleted: 1 });
      } else {
        const result = await deleteBrevoContactByEmail(job.brevo_contact_identifier, env);
        if (result.ok) {
          await markJob(db, jobId, { brevo_deleted: 1 });
        } else if (result.retryable) {
          await markJob(db, jobId, {
            status: 'pending',
            error_message: result.detail ?? 'Brevo transient failure',
          });
          return;
        } else {
          await markJob(db, jobId, {
            status: 'brevo_failed',
            error_message: result.detail ?? 'Brevo permanent failure',
          });
          return;
        }
      }
    }

    await markJob(db, jobId, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      error_message: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string })?.code;
    if (code === 'immediate_cancel_unsupported') {
      await markJob(db, jobId, { status: 'blocked', error_message: message });
      return;
    }
    console.error('[account-deletion] job failed', jobId, message);
    await markJob(db, jobId, { status: 'pending', error_message: message });
  }
}

/** Drain pending deletion jobs (scheduled Worker). */
export async function processAccountDeletionJobs(env: any, limit = 20): Promise<number> {
  const db = getDb(env);
  const pending = await db
    .prepare(
      `SELECT id FROM account_deletion_jobs
       WHERE status IN ('pending', 'running')
       ORDER BY updated_at ASC
       LIMIT ?`,
    )
    .bind(limit)
    .all();
  const rows = pending?.results ?? [];
  for (const row of rows) {
    await processAccountDeletionJob(env, String(row.id));
  }
  return rows.length;
}
