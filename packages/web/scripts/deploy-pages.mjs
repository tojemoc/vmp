import { execSync, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function readGitValue(command, fallback = '') {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return fallback;
  }
}

function sanitizeCommitMessage(input) {
  const normalized = (input || '')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return 'Deploy via Nx';
  return normalized.slice(0, 256);
}

const commitHash = process.env.GITHUB_SHA || readGitValue('git rev-parse HEAD');
const rawMessage = process.env.GITHUB_EVENT_HEAD_COMMIT_MESSAGE || readGitValue('git log -1 --pretty=%B');
const commitMessage = sanitizeCommitMessage(rawMessage);

// `pages_build_output_dir` in wrangler.toml supplies dist/; deploy from packages/web so config is loaded.
const args = [
  'wrangler',
  'pages',
  'deploy',
  '--project-name',
  'vmp-fe',
  '--branch',
  'main',
  '--commit-message',
  commitMessage,
];

if (commitHash) {
  args.push('--commit-hash', commitHash);
}

const result = spawnSync('npx', args, { stdio: 'inherit', cwd: webRoot });
process.exit(result.status ?? 1);
