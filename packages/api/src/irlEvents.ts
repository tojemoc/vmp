/**
 * Club IRL events — admin CRUD + account list/RSVP/check-in token.
 *
 * Routes:
 *   GET    /api/account/irl-events
 *   POST   /api/account/irl-events/:id/rsvp
 *   DELETE /api/account/irl-events/:id/rsvp
 *   GET    /api/admin/irl-events
 *   POST   /api/admin/irl-events
 *   PATCH  /api/admin/irl-events/:id
 *   DELETE /api/admin/irl-events/:id
 *   POST   /api/admin/irl-events/check-in
 */

import { canAccessIrlEvent } from '@vmp/shared';
import { requireAuth, requireRole } from './auth.js';
import { isAdministrativeRole } from './roles.js';

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

function errorResponse(error: string, status: number, corsHeaders: any, code?: string) {
  return jsonResponse(code ? { error, code } : { error }, status, corsHeaders);
}

function randomCheckInToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function trimText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

function parseOptionalCapacity(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) return undefined;
  return n;
}

function parseBool01(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return fallback;
}

async function getActiveSubscriptionPlanType(db: any, userId: string): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT plan_type FROM subscriptions
       WHERE user_id = ?
         AND status IN ('active', 'trialing')
         AND (current_period_end IS NULL OR datetime(current_period_end) > CURRENT_TIMESTAMP)
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .bind(userId)
    .first();
  return typeof row?.plan_type === 'string' ? row.plan_type : null;
}

function serializeEvent(row: any, extras: Record<string, unknown> = {}) {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? '',
    location: row.location ?? '',
    startsAt: row.starts_at,
    endsAt: row.ends_at ?? null,
    capacity: row.capacity == null ? null : Number(row.capacity),
    clubOnly: Number(row.club_only) === 1,
    published: Number(row.published) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...extras,
  };
}

async function countActiveRsvps(db: any, eventId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS c FROM irl_event_rsvps
       WHERE event_id = ? AND status IN ('confirmed', 'checked_in')`,
    )
    .bind(eventId)
    .first();
  return Number(row?.c ?? 0);
}

export async function handleListAccountIrlEvents(request: any, env: any, corsHeaders: any) {
  let user;
  try {
    user = await requireAuth(request, env);
  } catch {
    return errorResponse('Unauthorized', 401, corsHeaders);
  }

  const db = getDb(env);
  const planType = await getActiveSubscriptionPlanType(db, user.sub);
  const { results } = await db
    .prepare(
      `SELECT e.*,
              r.status AS rsvp_status,
              r.check_in_token AS check_in_token,
              r.checked_in_at AS checked_in_at,
              (SELECT COUNT(*) FROM irl_event_rsvps x
                WHERE x.event_id = e.id AND x.status IN ('confirmed', 'checked_in')) AS rsvp_count
       FROM irl_events e
       LEFT JOIN irl_event_rsvps r
         ON r.event_id = e.id AND r.user_id = ? AND r.status != 'cancelled'
       WHERE e.published = 1
         AND datetime(COALESCE(e.ends_at, e.starts_at)) >= datetime('now', '-1 day')
       ORDER BY datetime(e.starts_at) ASC`,
    )
    .bind(user.sub)
    .all();

  const events = (results ?? [])
    .filter((row: any) =>
      canAccessIrlEvent({
        clubOnly: Number(row.club_only) === 1,
        planType,
        role: user.role,
      }),
    )
    .map((row: any) =>
      serializeEvent(row, {
        rsvpCount: Number(row.rsvp_count ?? 0),
        rsvpStatus: row.rsvp_status ?? null,
        checkInToken: row.check_in_token ?? null,
        checkedInAt: row.checked_in_at ?? null,
        canRsvp: canAccessIrlEvent({
          clubOnly: Number(row.club_only) === 1,
          planType,
          role: user.role,
        }),
      }),
    );

  return jsonResponse(
    { events, planType, isStaff: isAdministrativeRole(user.role) },
    200,
    corsHeaders,
  );
}

export async function handleAccountIrlEventRsvp(
  request: any,
  env: any,
  corsHeaders: any,
  eventId: string,
) {
  let user;
  try {
    user = await requireAuth(request, env);
  } catch {
    return errorResponse('Unauthorized', 401, corsHeaders);
  }

  const db = getDb(env);
  const event = await db.prepare('SELECT * FROM irl_events WHERE id = ?').bind(eventId).first();
  if (!event || Number(event.published) !== 1) {
    return errorResponse('Event not found', 404, corsHeaders, 'irl_event_not_found');
  }

  const planType = await getActiveSubscriptionPlanType(db, user.sub);
  if (
    !canAccessIrlEvent({
      clubOnly: Number(event.club_only) === 1,
      planType,
      role: user.role,
    })
  ) {
    return errorResponse(
      'Club membership required for this event',
      403,
      corsHeaders,
      'irl_club_required',
    );
  }

  const existing = await db
    .prepare('SELECT * FROM irl_event_rsvps WHERE event_id = ? AND user_id = ?')
    .bind(eventId, user.sub)
    .first();

  if (existing && existing.status !== 'cancelled') {
    return jsonResponse(
      {
        ok: true,
        rsvp: {
          id: existing.id,
          status: existing.status,
          checkInToken: existing.check_in_token,
          checkedInAt: existing.checked_in_at ?? null,
        },
      },
      200,
      corsHeaders,
    );
  }

  if (event.capacity != null) {
    const count = await countActiveRsvps(db, eventId);
    if (count >= Number(event.capacity)) {
      return errorResponse('Event is at capacity', 409, corsHeaders, 'irl_event_full');
    }
  }

  const id = crypto.randomUUID();
  const token = randomCheckInToken();
  if (existing) {
    await db
      .prepare(
        `UPDATE irl_event_rsvps
         SET id = ?, check_in_token = ?, status = 'confirmed', checked_in_at = NULL, created_at = CURRENT_TIMESTAMP
         WHERE event_id = ? AND user_id = ?`,
      )
      .bind(id, token, eventId, user.sub)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO irl_event_rsvps (id, event_id, user_id, check_in_token, status)
         VALUES (?, ?, ?, ?, 'confirmed')`,
      )
      .bind(id, eventId, user.sub, token)
      .run();
  }

  return jsonResponse(
    { ok: true, rsvp: { id, status: 'confirmed', checkInToken: token, checkedInAt: null } },
    201,
    corsHeaders,
  );
}

export async function handleCancelAccountIrlEventRsvp(
  request: any,
  env: any,
  corsHeaders: any,
  eventId: string,
) {
  let user;
  try {
    user = await requireAuth(request, env);
  } catch {
    return errorResponse('Unauthorized', 401, corsHeaders);
  }

  const db = getDb(env);
  const result = await db
    .prepare(
      `UPDATE irl_event_rsvps
       SET status = 'cancelled'
       WHERE event_id = ? AND user_id = ? AND status IN ('confirmed', 'checked_in')`,
    )
    .bind(eventId, user.sub)
    .run();

  if (!result?.meta?.changes) {
    return errorResponse('RSVP not found', 404, corsHeaders, 'irl_rsvp_not_found');
  }
  return jsonResponse({ ok: true }, 200, corsHeaders);
}

export async function handleAdminListIrlEvents(request: any, env: any, corsHeaders: any) {
  try {
    await requireRole(request, env, 'editor', 'admin', 'super_admin');
  } catch {
    return errorResponse('Unauthorized', 401, corsHeaders);
  }

  const db = getDb(env);
  const { results } = await db
    .prepare(
      `SELECT e.*,
              (SELECT COUNT(*) FROM irl_event_rsvps x
                WHERE x.event_id = e.id AND x.status IN ('confirmed', 'checked_in')) AS rsvp_count
       FROM irl_events e
       ORDER BY datetime(e.starts_at) DESC`,
    )
    .all();

  return jsonResponse(
    {
      events: (results ?? []).map((row: any) =>
        serializeEvent(row, { rsvpCount: Number(row.rsvp_count ?? 0) }),
      ),
    },
    200,
    corsHeaders,
  );
}

export async function handleAdminCreateIrlEvent(request: any, env: any, corsHeaders: any) {
  try {
    await requireRole(request, env, 'editor', 'admin', 'super_admin');
  } catch {
    return errorResponse('Unauthorized', 401, corsHeaders);
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return errorResponse('Request body is required', 400, corsHeaders);
  }

  const title = trimText(body.title, 200);
  if (!title) return errorResponse('title is required', 400, corsHeaders);
  const startsAt = trimText(body.startsAt, 64);
  if (!startsAt) return errorResponse('startsAt is required', 400, corsHeaders);

  const description =
    typeof body.description === 'string' ? body.description.trim().slice(0, 4000) : '';
  const location = typeof body.location === 'string' ? body.location.trim().slice(0, 400) : '';
  const endsAt =
    typeof body.endsAt === 'string' && body.endsAt.trim() ? body.endsAt.trim().slice(0, 64) : null;
  const capacity = parseOptionalCapacity(body.capacity);
  if (body.capacity !== undefined && capacity === undefined) {
    return errorResponse('capacity must be a positive integer or null', 400, corsHeaders);
  }
  const clubOnly = parseBool01(body.clubOnly, true);
  const published = parseBool01(body.published, false);

  const id = crypto.randomUUID();
  const db = getDb(env);
  await db
    .prepare(
      `INSERT INTO irl_events
        (id, title, description, location, starts_at, ends_at, capacity, club_only, published)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      title,
      description,
      location,
      startsAt,
      endsAt,
      capacity === undefined ? null : capacity,
      clubOnly ? 1 : 0,
      published ? 1 : 0,
    )
    .run();

  const row = await db.prepare('SELECT * FROM irl_events WHERE id = ?').bind(id).first();
  return jsonResponse({ event: serializeEvent(row, { rsvpCount: 0 }) }, 201, corsHeaders);
}

export async function handleAdminUpdateIrlEvent(
  request: any,
  env: any,
  corsHeaders: any,
  eventId: string,
) {
  try {
    await requireRole(request, env, 'editor', 'admin', 'super_admin');
  } catch {
    return errorResponse('Unauthorized', 401, corsHeaders);
  }

  const db = getDb(env);
  const existing = await db.prepare('SELECT * FROM irl_events WHERE id = ?').bind(eventId).first();
  if (!existing) return errorResponse('Event not found', 404, corsHeaders);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return errorResponse('Request body is required', 400, corsHeaders);
  }

  const title = body.title !== undefined ? trimText(body.title, 200) : (existing.title as string);
  if (!title) return errorResponse('title is required', 400, corsHeaders);
  const startsAt =
    body.startsAt !== undefined ? trimText(body.startsAt, 64) : (existing.starts_at as string);
  if (!startsAt) return errorResponse('startsAt is required', 400, corsHeaders);

  const description =
    body.description !== undefined
      ? String(body.description).trim().slice(0, 4000)
      : (existing.description as string);
  const location =
    body.location !== undefined
      ? String(body.location).trim().slice(0, 400)
      : (existing.location as string);
  const endsAt =
    body.endsAt !== undefined
      ? typeof body.endsAt === 'string' && body.endsAt.trim()
        ? body.endsAt.trim().slice(0, 64)
        : null
      : (existing.ends_at as string | null);
  let capacity: number | null = existing.capacity == null ? null : Number(existing.capacity);
  if (body.capacity !== undefined) {
    const parsed = parseOptionalCapacity(body.capacity);
    if (parsed === undefined && body.capacity !== null && body.capacity !== '') {
      return errorResponse('capacity must be a positive integer or null', 400, corsHeaders);
    }
    capacity = parsed === undefined ? null : parsed;
  }
  const clubOnly =
    body.clubOnly !== undefined
      ? parseBool01(body.clubOnly, true)
      : Number(existing.club_only) === 1;
  const published =
    body.published !== undefined
      ? parseBool01(body.published, false)
      : Number(existing.published) === 1;

  await db
    .prepare(
      `UPDATE irl_events
       SET title = ?, description = ?, location = ?, starts_at = ?, ends_at = ?,
           capacity = ?, club_only = ?, published = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .bind(
      title,
      description,
      location,
      startsAt,
      endsAt,
      capacity,
      clubOnly ? 1 : 0,
      published ? 1 : 0,
      eventId,
    )
    .run();

  const row = await db.prepare('SELECT * FROM irl_events WHERE id = ?').bind(eventId).first();
  const rsvpCount = await countActiveRsvps(db, eventId);
  return jsonResponse({ event: serializeEvent(row, { rsvpCount }) }, 200, corsHeaders);
}

export async function handleAdminDeleteIrlEvent(
  request: any,
  env: any,
  corsHeaders: any,
  eventId: string,
) {
  try {
    await requireRole(request, env, 'editor', 'admin', 'super_admin');
  } catch {
    return errorResponse('Unauthorized', 401, corsHeaders);
  }

  const db = getDb(env);
  const result = await db.prepare('DELETE FROM irl_events WHERE id = ?').bind(eventId).run();
  if (!result?.meta?.changes) {
    return errorResponse('Event not found', 404, corsHeaders);
  }
  return jsonResponse({ ok: true }, 200, corsHeaders);
}

export async function handleAdminIrlEventCheckIn(request: any, env: any, corsHeaders: any) {
  try {
    await requireRole(request, env, 'editor', 'admin', 'super_admin');
  } catch {
    return errorResponse('Unauthorized', 401, corsHeaders);
  }

  const body = await request.json().catch(() => null);
  const token = trimText(body?.checkInToken ?? body?.token, 64);
  if (!token) return errorResponse('checkInToken is required', 400, corsHeaders);

  const db = getDb(env);
  const rsvp = await db
    .prepare(
      `SELECT r.*, e.title AS event_title, u.email AS user_email
       FROM irl_event_rsvps r
       JOIN irl_events e ON e.id = r.event_id
       JOIN users u ON u.id = r.user_id
       WHERE r.check_in_token = ?`,
    )
    .bind(token)
    .first();

  if (!rsvp || rsvp.status === 'cancelled') {
    return errorResponse('Check-in token not found', 404, corsHeaders, 'irl_checkin_not_found');
  }

  if (rsvp.status !== 'checked_in') {
    await db
      .prepare(
        `UPDATE irl_event_rsvps
         SET status = 'checked_in', checked_in_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(rsvp.id)
      .run();
  }

  return jsonResponse(
    {
      ok: true,
      alreadyCheckedIn: rsvp.status === 'checked_in',
      rsvp: {
        id: rsvp.id,
        eventId: rsvp.event_id,
        eventTitle: rsvp.event_title,
        userId: rsvp.user_id,
        userEmail: rsvp.user_email,
        status: 'checked_in',
        checkInToken: rsvp.check_in_token,
        checkedInAt: rsvp.checked_in_at ?? new Date().toISOString(),
      },
    },
    200,
    corsHeaders,
  );
}
