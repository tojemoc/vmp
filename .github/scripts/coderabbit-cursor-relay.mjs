/**
 * Relays CodeRabbit bot events to a human-authored PR comment that Cursor
 * automations can match. Cursor intentionally ignores comments from bots /
 * GitHub Apps, so coderabbitai[bot] never reaches a PR-comment trigger.
 *
 * Invoked from coderabbit-cursor-relay.yml (inline Node — no third-party
 * action download, avoids codeload 429s).
 *
 * Required secret: CURSOR_AUTOMATION_PAT — a classic or fine-grained PAT
 * belonging to a *User* account (not a GitHub App). That user must be able
 * to comment on PRs in this repo.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const RELAY_MARKER = '<!-- cursor-coderabbit-relay -->';
export const RELAY_MENTION = '@cursor coderabbit-relay';
export const BOT_LOGIN = 'coderabbitai[bot]';
export const MANUAL_TRIGGER_PHRASE = '@coderabbitai review';

/**
 * Classify a CodeRabbit issue comment or pull-request review body.
 *
 * @param {{ eventName: string, body: string }} input
 * @returns {{
 *   kind: 'ratelimit' | 'actionable' | 'manual_trigger' | 'ignore',
 *   waitMinutes?: number | null,
 *   actionableCount?: number | null,
 *   runId?: string | null,
 *   reason?: string,
 * }}
 */
export function classifyCodeRabbitEvent({ eventName, body }) {
  if (!body || typeof body !== 'string') {
    return { kind: 'ignore', reason: 'empty' };
  }

  // Rate-limit warnings often also carry the summarize HTML marker — check first.
  if (/rate limited by coderabbit\.ai/i.test(body) || /##\s*Review limit reached/i.test(body)) {
    const waitMatch = body.match(
      /next(?:\s+included)?\s+review\s+available\s+in[:\s]*(\d+)\s*minutes?/i,
    );
    return {
      kind: 'ratelimit',
      waitMinutes: waitMatch ? Number.parseInt(waitMatch[1], 10) : null,
      runId: parseCodeRabbitRunId(body),
    };
  }

  if (/should be triggered manually/i.test(body)) {
    return { kind: 'manual_trigger' };
  }

  if (
    /skip review by coderabbit\.ai/i.test(body) ||
    /##\s*Draft PR not reviewed/i.test(body) ||
    /##\s*Review skipped/i.test(body)
  ) {
    return { kind: 'ignore', reason: 'skipped' };
  }

  // Explicit clean bill — do not wake Cursor (loop ends naturally).
  if (/No actionable comments were generated in the recent review/i.test(body)) {
    return { kind: 'ignore', reason: 'clear' };
  }

  // Actionable findings live on pull_request_review bodies. Do not treat
  // summarize walkthrough issue_comments as actionable — those often arrive
  // alongside the review and would double-wake Cursor for the same round.
  if (eventName === 'pull_request_review') {
    const actionable = body.match(/Actionable comments posted:\s*(\d+)/i);
    if (actionable) {
      const count = Number.parseInt(actionable[1], 10);
      if (count > 0) {
        return {
          kind: 'actionable',
          actionableCount: count,
          runId: parseCodeRabbitRunId(body),
        };
      }
      return { kind: 'ignore', reason: 'actionable_zero' };
    }
  }

  return { kind: 'ignore', reason: 'unmatched' };
}

/**
 * Extract CodeRabbit's Run ID from a comment/review body when present.
 * @param {string} body
 * @returns {string | null}
 */
export function parseCodeRabbitRunId(body) {
  if (!body || typeof body !== 'string') return null;
  const match = body.match(
    /\*{0,2}Run ID\*{0,2}:\s*`([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})`/i,
  );
  return match ? match[1].toLowerCase() : null;
}

/**
 * Stable revision key for one CodeRabbit event state.
 * Rate-limit notices reuse the same comment id when the wait window changes;
 * bundling updated_at + wait_minutes lets each window relay separately.
 * Actionable reviews may reuse the same GitHub review id and count across
 * CodeRabbit runs — include runId when present so a new run re-relays.
 *
 * @param {{
 *   kind: 'ratelimit' | 'actionable',
 *   updatedAt: string | Date | null | undefined,
 *   waitMinutes?: number | null,
 *   actionableCount?: number | null,
 *   runId?: string | null,
 * }} opts
 */
export function buildEventRevision(opts) {
  const ts =
    opts.updatedAt == null || opts.updatedAt === ''
      ? 'unknown'
      : new Date(opts.updatedAt).toISOString();

  if (opts.kind === 'ratelimit') {
    const wait = opts.waitMinutes == null ? 'unknown' : String(opts.waitMinutes);
    return `${ts}|wait=${wait}`;
  }

  const count = opts.actionableCount == null ? 'unknown' : String(opts.actionableCount);
  const run = opts.runId ? `|run=${opts.runId}` : '';
  return `${ts}|actionable=${count}${run}`;
}

/**
 * @param {{
 *   kind: 'ratelimit' | 'actionable',
 *   prNumber: number,
 *   source: 'comment' | 'review',
 *   sourceId: number | string,
 *   revision: string,
 *   waitMinutes?: number | null,
 *   actionableCount?: number | null,
 *   runId?: string | null,
 * }} opts
 */
export function buildRelayCommentBody(opts) {
  const lines = [
    RELAY_MARKER,
    RELAY_MENTION,
    '',
    '```',
    `kind: ${opts.kind}`,
    `pr: ${opts.prNumber}`,
    `source: ${opts.source}`,
    `source_id: ${opts.sourceId}`,
    `revision: ${opts.revision}`,
  ];

  if (opts.kind === 'ratelimit') {
    lines.push(`wait_minutes: ${opts.waitMinutes == null ? 'unknown' : opts.waitMinutes}`);
  }
  if (opts.kind === 'actionable' && opts.actionableCount != null) {
    lines.push(`actionable_count: ${opts.actionableCount}`);
  }
  if (opts.runId) {
    lines.push(`run_id: ${opts.runId}`);
  }

  lines.push('```', '');
  return lines.join('\n');
}

function makeHeaders(token, userAgent) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': userAgent,
  };
}

async function gh(token, path, options = {}) {
  const headers = {
    ...makeHeaders(token, 'vmp-coderabbit-cursor-relay'),
    ...(options.headers ?? {}),
  };
  const res = await fetch(`https://api.github.com${path}`, { ...options, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${options.method ?? 'GET'} ${path}: ${res.status} ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function listAllComments(token, owner, repo, issueNumber) {
  const comments = [];
  let page = 1;
  while (true) {
    const batch = await gh(
      token,
      `/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100&page=${page}`,
    );
    comments.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }
  return comments;
}

/**
 * @param {Array<{ body?: string, user?: { login?: string } }>} comments
 * @param {{
 *   kind: string,
 *   sourceId: number | string,
 *   revision: string,
 *   authorLogin: string,
 * }} opts
 */
export function alreadyRelayed(comments, { kind, sourceId, revision, authorLogin }) {
  if (!authorLogin) {
    throw new Error('alreadyRelayed requires authorLogin (PAT /user login)');
  }
  const needleKind = `kind: ${kind}`;
  const needleSource = `source_id: ${sourceId}`;
  const needleRevision = `revision: ${revision}`;
  return comments.some(
    (c) =>
      c.user?.login === authorLogin &&
      typeof c.body === 'string' &&
      c.body.includes(RELAY_MARKER) &&
      c.body.includes(needleKind) &&
      c.body.includes(needleSource) &&
      c.body.includes(needleRevision),
  );
}

function alreadyManualRetrigger(comments, afterTime) {
  return comments.some(
    (c) => /@coderabbitai review/i.test(c.body ?? '') && new Date(c.created_at) > afterTime,
  );
}

/**
 * @param {{
 *   eventName: string,
 *   payload: object,
 *   owner: string,
 *   repo: string,
 *   githubToken: string,
 *   relayPat: string | undefined,
 * }} ctx
 */
export async function runRelay(ctx) {
  const { eventName, payload, owner, repo, githubToken, relayPat } = ctx;

  let body;
  let prNumber;
  let source;
  let sourceId;
  let sourceTime;
  let sourceUpdatedAt;

  if (eventName === 'issue_comment') {
    body = payload.comment?.body ?? '';
    prNumber = payload.issue?.number;
    source = 'comment';
    sourceId = payload.comment?.id;
    sourceUpdatedAt = payload.comment?.updated_at || payload.comment?.created_at;
    sourceTime = new Date(sourceUpdatedAt);
  } else if (eventName === 'pull_request_review') {
    body = payload.review?.body ?? '';
    prNumber = payload.pull_request?.number;
    source = 'review';
    sourceId = payload.review?.id;
    sourceUpdatedAt =
      payload.review?.submitted_at || payload.review?.edited_at || new Date().toISOString();
    sourceTime = new Date(sourceUpdatedAt);
  } else {
    console.log(`Unsupported event ${eventName}, skipping.`);
    return { status: 'skipped', reason: 'unsupported_event' };
  }

  if (!prNumber || sourceId == null) {
    console.log('Missing PR number or source id, skipping.');
    return { status: 'skipped', reason: 'missing_ids' };
  }

  const classification = classifyCodeRabbitEvent({ eventName, body });
  console.log(
    `Classified as ${classification.kind}${classification.reason ? ` (${classification.reason})` : ''}`,
  );

  if (classification.kind === 'ignore') {
    return { status: 'skipped', reason: classification.reason ?? 'ignore' };
  }

  const comments = await listAllComments(githubToken, owner, repo, prNumber);

  if (classification.kind === 'manual_trigger') {
    if (alreadyManualRetrigger(comments, sourceTime)) {
      console.log('Already posted @coderabbitai review for this notice, skipping.');
      return { status: 'skipped', reason: 'already_manual' };
    }
    await gh(githubToken, `/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: MANUAL_TRIGGER_PHRASE }),
    });
    console.log(`Posted ${MANUAL_TRIGGER_PHRASE} on PR #${prNumber}.`);
    return { status: 'posted', kind: 'manual_trigger' };
  }

  if (!relayPat) {
    throw new Error(
      'CURSOR_AUTOMATION_PAT is not set. Add a User PAT (not GITHUB_TOKEN) as a repo secret so Cursor can see the relay comment.',
    );
  }

  const me = await gh(relayPat, '/user');
  const relayAuthorLogin = me?.login;
  if (!relayAuthorLogin || typeof relayAuthorLogin !== 'string') {
    throw new Error(
      'CURSOR_AUTOMATION_PAT did not resolve to a GitHub user login via GET /user. Check the token scopes.',
    );
  }

  const revision = buildEventRevision({
    kind: classification.kind,
    updatedAt: sourceUpdatedAt,
    waitMinutes: classification.waitMinutes,
    actionableCount: classification.actionableCount,
    runId: classification.runId,
  });

  if (
    alreadyRelayed(comments, {
      kind: classification.kind,
      sourceId,
      revision,
      authorLogin: relayAuthorLogin,
    })
  ) {
    console.log(
      `Already relayed ${classification.kind} for source_id ${sourceId} revision ${revision} by ${relayAuthorLogin}, skipping.`,
    );
    return { status: 'skipped', reason: 'already_relayed' };
  }

  const relayBody = buildRelayCommentBody({
    kind: classification.kind,
    prNumber,
    source,
    sourceId,
    revision,
    waitMinutes: classification.waitMinutes,
    actionableCount: classification.actionableCount,
    runId: classification.runId,
  });

  await gh(relayPat, `/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: relayBody }),
  });

  console.log(
    `Posted Cursor relay (${classification.kind}) on PR #${prNumber} as ${relayAuthorLogin}.`,
  );
  return { status: 'posted', kind: classification.kind, authorLogin: relayAuthorLogin, revision };
}

async function main() {
  const githubToken = process.env.GITHUB_TOKEN;
  const relayPat = process.env.CURSOR_AUTOMATION_PAT || undefined;
  const eventName = process.env.GITHUB_EVENT_NAME;
  const [owner, repo] = (process.env.GITHUB_REPOSITORY || '/').split('/');
  const payload = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));

  if (!githubToken) throw new Error('GITHUB_TOKEN is required');
  if (!eventName) throw new Error('GITHUB_EVENT_NAME is required');

  await runRelay({
    eventName,
    payload,
    owner,
    repo,
    githubToken,
    relayPat,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
