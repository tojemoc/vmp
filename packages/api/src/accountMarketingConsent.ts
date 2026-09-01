/**
 * packages/api/src/accountMarketingConsent.ts
 *
 * Self-service marketing consent endpoints for the signed-in user:
 *   GET  /api/account/marketing-consent  — read the current consent state
 *   PUT  /api/account/marketing-consent  — grant or withdraw consent
 *
 * Granting consent adds the user to the Brevo marketing list (honoring any Brevo
 * opt-out); withdrawing consent removes them. This is the only path that changes
 * marketing list membership by intent — billing events never do.
 */

import { requireAuth } from './auth.js';
import { removeSubscriberFromNewsletter, syncPayingSubscriberToNewsletter } from './brevo.js';
import {
  MARKETING_CONSENT_VERSION,
  readMarketingConsent,
  writeMarketingConsent,
} from './marketingConsent.js';

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

function serializeConsent(state: any) {
  return {
    consented: !!state?.consented,
    consentedAt: state?.consentedAt ?? null,
    version: state?.version ?? null,
    currentVersion: MARKETING_CONSENT_VERSION,
  };
}

export async function handleGetAccountMarketingConsent(request: any, env: any, corsHeaders: any) {
  let user;
  try {
    user = await requireAuth(request, env);
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders);
  }

  const db = getDb(env);
  const state = await readMarketingConsent(db, user.sub);
  if (!state) return jsonResponse({ error: 'Not found' }, 404, corsHeaders);
  return jsonResponse(serializeConsent(state), 200, corsHeaders);
}

export async function handlePutAccountMarketingConsent(request: any, env: any, corsHeaders: any) {
  let user;
  try {
    user = await requireAuth(request, env);
  } catch {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders);
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body.consent !== 'boolean') {
    return jsonResponse({ error: 'consent (boolean) is required' }, 400, corsHeaders);
  }

  const db = getDb(env);
  const state = await writeMarketingConsent(db, user.sub, body.consent);
  if (!state) return jsonResponse({ error: 'Not found' }, 404, corsHeaders);

  // Reflect the intent on the Brevo list. Failures here must not fail the
  // request: the consent record is the source of truth and a later sync retries.
  try {
    if (body.consent) {
      await syncPayingSubscriberToNewsletter(db, user.sub, env);
    } else {
      await removeSubscriberFromNewsletter(db, user.sub, env);
    }
  } catch (err) {
    console.error('[account] marketing consent brevo sync failed', {
      fn: body.consent ? 'syncPayingSubscriberToNewsletter' : 'removeSubscriberFromNewsletter',
      err,
    });
  }

  return jsonResponse(serializeConsent(state), 200, corsHeaders);
}
