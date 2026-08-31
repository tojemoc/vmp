/**
 * Retries CodeRabbit reviews after rate-limit countdown expires.
 * Invoked from bot-review-limit-cron.yml (no third-party action download).
 */
const token = process.env.GITHUB_TOKEN;
const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
const BOT_LOGIN = 'coderabbitai[bot]';
const TRIGGER_PHRASE = '@coderabbitai review';

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'vmp-coderabbit-review-limit-retry',
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

async function listAll(pathBuilder) {
  const items = [];
  let page = 1;
  while (true) {
    const batch = await gh(pathBuilder(page));
    items.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }
  return items;
}

const openPRs = await listAll(
  (page) => `/repos/${owner}/${repo}/pulls?state=open&per_page=100&page=${page}`,
);

for (const pr of openPRs) {
  const comments = await listAll(
    (page) =>
      `/repos/${owner}/${repo}/issues/${pr.number}/comments?per_page=100&page=${page}`,
  );

  const botComments = comments.filter((c) => c.user.login === BOT_LOGIN);
  if (botComments.length === 0) continue;

  const last = botComments[botComments.length - 1];
  const match = last.body.match(/next review available in:\s*(\d+)\s*minutes?/i);
  if (!match) continue;

  const waitMinutes = Number.parseInt(match[1], 10);
  const countdownSetAt = new Date(last.updated_at || last.created_at);
  const eta = new Date(countdownSetAt.getTime() + waitMinutes * 60_000);

  if (new Date() < eta) {
    console.log(`PR #${pr.number}: still limited until ${eta.toISOString()}`);
    continue;
  }

  const alreadyRetried = comments.some(
    (c) =>
      c.user.login === 'github-actions[bot]' &&
      c.body.trim() === TRIGGER_PHRASE &&
      new Date(c.created_at) > countdownSetAt,
  );
  if (alreadyRetried) {
    console.log(`PR #${pr.number}: already retried, skipping.`);
    continue;
  }

  console.log(`PR #${pr.number}: wait window elapsed, posting retry.`);
  await gh(`/repos/${owner}/${repo}/issues/${pr.number}/comments`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: TRIGGER_PHRASE }),
  });
}
