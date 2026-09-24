import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  alreadyRelayed,
  buildEventRevision,
  buildRelayCommentBody,
  classifyCodeRabbitEvent,
  RELAY_MARKER,
  RELAY_MENTION,
} from './coderabbit-cursor-relay.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'fixtures');
const RELAY_AUTHOR = 'pat-owner';

function fixture(name) {
  return readFileSync(join(fixturesDir, name), 'utf8');
}

function relayComment({ kind, sourceId, revision, waitMinutes, authorLogin = RELAY_AUTHOR }) {
  return {
    user: { login: authorLogin },
    body: buildRelayCommentBody({
      kind,
      prNumber: 697,
      source: 'comment',
      sourceId,
      revision,
      waitMinutes,
    }),
  };
}

describe('classifyCodeRabbitEvent', () => {
  it('classifies rate-limit warnings and extracts wait minutes', () => {
    const result = classifyCodeRabbitEvent({
      eventName: 'issue_comment',
      body: fixture('coderabbit-ratelimit.md'),
    });
    assert.equal(result.kind, 'ratelimit');
    assert.equal(result.waitMinutes, 54);
  });

  it('ignores clear summarize comments', () => {
    const result = classifyCodeRabbitEvent({
      eventName: 'issue_comment',
      body: fixture('coderabbit-clear.md'),
    });
    assert.equal(result.kind, 'ignore');
    assert.equal(result.reason, 'clear');
  });

  it('ignores draft / skipped review notices', () => {
    const result = classifyCodeRabbitEvent({
      eventName: 'issue_comment',
      body: fixture('coderabbit-skip-draft.md'),
    });
    assert.equal(result.kind, 'ignore');
    assert.equal(result.reason, 'skipped');
  });

  it('classifies PR reviews with actionable findings', () => {
    const result = classifyCodeRabbitEvent({
      eventName: 'pull_request_review',
      body: fixture('coderabbit-actionable-review.md'),
    });
    assert.equal(result.kind, 'actionable');
    assert.equal(result.actionableCount, 5);
  });

  it('classifies manual-trigger notices', () => {
    const result = classifyCodeRabbitEvent({
      eventName: 'issue_comment',
      body: 'Reviews on this repository should be triggered manually.\n\n@coderabbitai review',
    });
    assert.equal(result.kind, 'manual_trigger');
  });

  it('does not treat summarize walkthrough issue_comments as actionable', () => {
    const body = [
      '<!-- This is an auto-generated comment: summarize by coderabbit.ai -->',
      '<!-- walkthrough_start -->',
      '## Walkthrough',
      'Something changed.',
      '<!-- walkthrough_end -->',
    ].join('\n');
    const result = classifyCodeRabbitEvent({
      eventName: 'issue_comment',
      body,
    });
    assert.equal(result.kind, 'ignore');
    assert.equal(result.reason, 'unmatched');
  });

  it('ignores Actionable comments posted on issue_comment (wrong event)', () => {
    const result = classifyCodeRabbitEvent({
      eventName: 'issue_comment',
      body: '**Actionable comments posted: 3**\n\nDetails…',
    });
    assert.equal(result.kind, 'ignore');
  });

  it('prefers ratelimit over summarize when both markers are present', () => {
    const body = [
      '<!-- This is an auto-generated comment: summarize by coderabbit.ai -->',
      '<!-- This is an auto-generated comment: rate limited by coderabbit.ai -->',
      '> ## Review limit reached',
      '> **Next included review available in 12 minutes.**',
      '<!-- walkthrough_start -->',
      '## Walkthrough',
    ].join('\n');
    const result = classifyCodeRabbitEvent({
      eventName: 'issue_comment',
      body,
    });
    assert.equal(result.kind, 'ratelimit');
    assert.equal(result.waitMinutes, 12);
  });
});

describe('buildRelayCommentBody', () => {
  it('emits a stable Cursor match string and machine-readable block', () => {
    const revision = buildEventRevision({
      kind: 'ratelimit',
      updatedAt: '2026-09-22T12:00:00.000Z',
      waitMinutes: 54,
    });
    const body = buildRelayCommentBody({
      kind: 'ratelimit',
      prNumber: 697,
      source: 'comment',
      sourceId: 42,
      revision,
      waitMinutes: 54,
    });
    assert.ok(body.startsWith(RELAY_MARKER));
    assert.ok(body.includes(RELAY_MENTION));
    assert.ok(body.includes('kind: ratelimit'));
    assert.ok(body.includes('wait_minutes: 54'));
    assert.ok(body.includes('source_id: 42'));
    assert.ok(body.includes(`revision: ${revision}`));
  });
});

describe('buildEventRevision + alreadyRelayed', () => {
  it('uses distinct revisions when the same comment id gets a new wait window', () => {
    const sourceId = 424242;
    const rev54 = buildEventRevision({
      kind: 'ratelimit',
      updatedAt: '2026-09-22T10:00:00.000Z',
      waitMinutes: 54,
    });
    const rev12 = buildEventRevision({
      kind: 'ratelimit',
      updatedAt: '2026-09-22T11:00:00.000Z',
      waitMinutes: 12,
    });
    assert.notEqual(rev54, rev12);

    const comments = [
      relayComment({ kind: 'ratelimit', sourceId, revision: rev54, waitMinutes: 54 }),
    ];

    assert.equal(
      alreadyRelayed(comments, {
        kind: 'ratelimit',
        sourceId,
        revision: rev54,
        authorLogin: RELAY_AUTHOR,
      }),
      true,
    );
    assert.equal(
      alreadyRelayed(comments, {
        kind: 'ratelimit',
        sourceId,
        revision: rev12,
        authorLogin: RELAY_AUTHOR,
      }),
      false,
      'a different wait window must not be treated as already relayed',
    );
  });

  it('ignores spoofed relay markers from other authors', () => {
    const revision = buildEventRevision({
      kind: 'ratelimit',
      updatedAt: '2026-09-22T10:00:00.000Z',
      waitMinutes: 30,
    });
    const comments = [
      relayComment({
        kind: 'ratelimit',
        sourceId: 7,
        revision,
        waitMinutes: 30,
        authorLogin: 'attacker',
      }),
    ];
    assert.equal(
      alreadyRelayed(comments, {
        kind: 'ratelimit',
        sourceId: 7,
        revision,
        authorLogin: RELAY_AUTHOR,
      }),
      false,
    );
  });

  it('requires authorLogin', () => {
    assert.throws(() => alreadyRelayed([], { kind: 'ratelimit', sourceId: 1, revision: 'x' }), {
      message: /authorLogin/,
    });
  });
});
