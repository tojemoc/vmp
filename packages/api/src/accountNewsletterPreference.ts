/**
 * packages/api/src/accountNewsletterPreference.ts
 *
 * Self-service newsletter preference for the signed-in user:
 *   GET  /api/account/newsletter-preference  — read opt-out state
 *   PUT  /api/account/newsletter-preference  — set or clear opt-out
 *
 * Opting out removes the user from the Brevo marketing list; clearing opt-out
 * re-adds them when they are a paying subscriber. System / transactional email
 * is never affected.
 */

import { requireAuth } from './auth.js';
import { removeSubscriberFromNewsletter, syncPayingSubscriberToNewsletter } from './brevo.js';
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

  // Reflect preference on the Brevo marketing list. Failures must not fail the
  // request: the preference row is source of truth and a later sync retries.
  try {
    if (body.optedOut) {
      await removeSubscriberFromNewsletter(db, user.sub, env);
    } else {
      await syncPayingSubscriberToNewsletter(db, user.sub, env);
    }
  } catch (err) {
    console.error('[account] newsletter preference brevo sync failed', {
      fn: body.optedOut ? 'removeSubscriberFromNewsletter' : 'syncPayingSubscriberToNewsletter',
      err,
    });
  }

  return jsonResponse(serializePreference(state), 200, corsHeaders);
}
