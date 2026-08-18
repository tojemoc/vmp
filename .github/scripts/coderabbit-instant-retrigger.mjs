/**
 * Posts "@coderabbitai review" when CodeRabbit's manual-trigger notice appears.
 * Invoked from coderabbit-instant-trigger.yml (no third-party action download).
 */
import { readFileSync } from 'node:fs';

const token = process.env.GITHUB_TOKEN;
const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
const payload = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));

const body = payload.comment.body;
const prNumber = payload.issue.number;

if (!/should be triggered manually/i.test(body)) {
  console.log('Not a manual-trigger notice, skipping.');
  process.exit(0);
}

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'vmp-coderabbit-instant-retrigger',
};

async function gh(path, options = {}) {
  const res = await fetch(`https://api.github.com${path}`, { ...options, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${options.method ?? 'GET'} ${path}: ${res.status} ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function listAllComments(issueNumber) {
  const comments = [];
  let page = 1;
  while (true) {
    const batch = await gh(
      `/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100&page=${page}`,
    );
    comments.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }
  return comments;
}

const thisCommentTime = new Date(
  payload.comment.updated_at || payload.comment.created_at,
);

const comments = await listAllComments(prNumber);
const alreadyRetriggered = comments.some(
  (c) =>
    c.user.login === 'github-actions[bot]' &&
    /@coderabbitai review/i.test(c.body) &&
    new Date(c.created_at) > thisCommentTime,
);

if (alreadyRetriggered) {
  console.log('Already retriggered for this comment state, skipping.');
  process.exit(0);
}

await gh(`/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({ body: '@coderabbitai review' }),
});

console.log(`Posted @coderabbitai review on PR #${prNumber}.`);
