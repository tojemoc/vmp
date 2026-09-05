/**
 * packages/api/src/accountNewsletterPreference.ts
 *
 * Self-service newsletter preference for the signed-in user:
 *   GET  /api/account/newsletter-preference  — read opt-out state
 *   PUT  /api/account/newsletter-preference  — set or clear opt-out
 *
 * Membership is derived from preference + active/trialing subscription via
 * reconcileNewsletterMembershipForUser (which calls syncPayingSubscriberToNewsletter
 * for eligible opt-ins). Opt-out failures enqueue durable Brevo reconciliation
 * for the scheduled Worker. System / transactional email is never affected.
 */

import { requireAuth } from './auth.js';
import {
  enqueueNewsletterBrevoReconcile,
  reconcileNewsletterMembershipForUser,
} from './brevo.js';
import {
  NEWSLETTER_OPT_OUT_VERSION,
  readNewsletterPreference,
  writeNewsletterPreference,
} from './newsletterPreference.js';

function jsonResponse(data: any, status = 200, corsHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function getDb(env: any) {
  const db = env.DB || env.video_subscription_db;
  if (!db) throw new Error('D1 binding not found');
  return db;
}

function serializePreference(state: any) {
  return {
    optedOut: !!state?.optedOut,
    optedOutAt: state?.optedOutAt ?? null,
    version: state?.version ?? null,
    currentVersion: NEWSLETTER_OPT_OUT_VERSION,
  };
}

export async function handleGetAccountNewsletterPreference(
  request: any,
  env: any,
  corsHeaders: any,
) {
  let user;
  try {
    user = await requireAuth(request, env);
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders);
  }

  const db = getDb(env);
  const state = await readNewsletterPreference(db, user.sub);
  if (!state) return jsonResponse({ error: 'Not found' }, 404, corsHeaders);
  return jsonResponse(serializePreference(state), 200, corsHeaders);
}

export async function handlePutAccountNewsletterPreference(
  request: any,
  env: any,
  corsHeaders: any,
) {
  let user;
  try {
    user = await requireAuth(request, env);
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders);
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body.optedOut !== 'boolean') {
    return jsonResponse({ error: 'optedOut (boolean) is required' }, 400, corsHeaders);
  }

  const db = getDb(env);
  const state = await writeNewsletterPreference(db, user.sub, body.optedOut);
  if (!state) return jsonResponse({ error: 'Not found' }, 404, corsHeaders);

  // Preference row is source of truth. Brevo failures must not fail the request.
  try {
    const ok = await reconcileNewsletterMembershipForUser(db, user.sub, env);
    if (body.optedOut && !ok) {
      await enqueueNewsletterBrevoReconcile(db, user.sub);
    }
  } catch (err) {
    console.error('[account] newsletter preference brevo sync failed', {
      fn: 'reconcileNewsletterMembershipForUser',
      optedOut: body.optedOut,
      err,
    });
    if (body.optedOut) {
      try {
        await enqueueNewsletterBrevoReconcile(db, user.sub);
      } catch (enqueueErr) {
        console.error('[account] newsletter brevo reconcile enqueue failed', { err: enqueueErr });
      }
    }
  }

  return jsonResponse(serializePreference(state), 200, corsHeaders);
}
