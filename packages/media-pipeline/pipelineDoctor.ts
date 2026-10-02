/**
 * Fail-fast configuration checks for the media ingest pipeline.
 * Run at supervisor boot and via `npm run encore:doctor`.
 */

import { access, constants, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createClient } from 'redis';
import { checkEncoreHealth } from './encoreClient.js';
import { isLoopbackEncoreUrl } from './packagerEncoreUrl.js';
import { isLoopbackHost } from './supervisorAuth.js';

export type DoctorSeverity = 'fatal' | 'warn' | 'ok';

export type DoctorFinding = {
  id: string;
  severity: DoctorSeverity;
  message: string;
};

export type DoctorReport = {
  ok: boolean;
  findings: DoctorFinding[];
};

function finding(id: string, severity: DoctorSeverity, message: string): DoctorFinding {
  return { id, severity, message };
}

/** Mask userinfo in Redis/connection URLs for doctor findings. */
export function redactUrlCredentials(urlString: string): string {
  const raw = String(urlString ?? '').trim();
  if (!raw) return '[empty-url]';
  try {
    const u = new URL(raw);
    if (u.username || u.password) {
      u.username = u.username ? '***' : '';
      u.password = u.password ? '***' : '';
    }
    return u.toString();
  } catch {
    return '[invalid-url]';
  }
}

function isBase64UrlSecret(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
}

async function pathWritable(dir: string): Promise<boolean> {
  try {
    await mkdir(dir, { recursive: true });
    await access(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function checkRedis(redisUrl: string): Promise<DoctorFinding> {
  const client = createClient({ url: redisUrl });
  client.on('error', () => {
    /* swallowed — connect() rejects */
  });
  try {
    await client.connect();
    const pong = await client.ping();
    await client.quit();
    if (pong !== 'PONG') {
      return finding('redis', 'fatal', `Redis ping returned unexpected value: ${String(pong)}`);
    }
    return finding('redis', 'ok', `Redis OK (${redactUrlCredentials(redisUrl)})`);
  } catch (err) {
    try {
      await client.quit();
    } catch {
      /* ignore */
    }
    return finding(
      'redis',
      'fatal',
      `Redis unreachable at ${redactUrlCredentials(redisUrl)}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function checkStorageConfigured(env: NodeJS.ProcessEnv): Promise<DoctorFinding[]> {
  const out: DoctorFinding[] = [];
  const provider = (env.STORAGE_PROVIDER || 'r2').trim().toLowerCase();
  const hasAws = Boolean(env.AWS_ACCESS_KEY_ID?.trim() && env.AWS_SECRET_ACCESS_KEY?.trim());
  const hasB2 = Boolean(env.B2_ACCESS_KEY_ID?.trim() && env.B2_SECRET_ACCESS_KEY?.trim());
  const endpoint =
    env.S3_ENDPOINT_URL?.trim() ||
    env.S3_ENDPOINT?.trim() ||
    env.B2_S3_ENDPOINT?.trim() ||
    env.B2_ENDPOINT?.trim() ||
    env.R2_ENDPOINT?.trim();
  const bucket =
    env.S3_BUCKET_NAME?.trim() ||
    env.B2_BUCKET_NAME?.trim() ||
    env.R2_BUCKET_NAME?.trim() ||
    env.STORAGE_BUCKET?.trim() ||
    env.PACKAGE_OUTPUT_FOLDER?.trim();

  if (!bucket) {
    out.push(
      finding(
        'storage.bucket',
        'fatal',
        'No bucket configured (S3_BUCKET_NAME / B2_BUCKET_NAME / PACKAGE_OUTPUT_FOLDER)',
      ),
    );
  } else {
    out.push(finding('storage.bucket', 'ok', `Bucket config present (${bucket})`));
  }

  if (provider === 'b2' || hasB2) {
    if (!hasB2 && !hasAws) {
      out.push(
        finding(
          'storage.creds',
          'fatal',
          'B2/S3 credentials missing (B2_ACCESS_KEY_ID/B2_SECRET_ACCESS_KEY or AWS_*)',
        ),
      );
    } else {
      out.push(finding('storage.creds', 'ok', 'Object storage credentials present'));
    }
    if (!endpoint) {
      out.push(
        finding(
          'storage.endpoint',
          'fatal',
          'S3 endpoint missing (S3_ENDPOINT_URL / B2_S3_ENDPOINT) — packager and supervisor uploads will fail',
        ),
      );
    } else {
      out.push(finding('storage.endpoint', 'ok', `S3 endpoint ${endpoint}`));
    }
  } else if (!hasAws && !hasB2) {
    out.push(
      finding(
        'storage.creds',
        'warn',
        `STORAGE_PROVIDER=${provider} without AWS_/B2_ keys — podcast sidecar uploads may fail`,
      ),
    );
  }

  if (!env.PACKAGE_OUTPUT_FOLDER?.trim()) {
    out.push(
      finding(
        'packager.output',
        'warn',
        'PACKAGE_OUTPUT_FOLDER unset (compose default s3://vmp-videos/videos)',
      ),
    );
  }

  return out;
}

/** Run configuration + dependency checks. Does not mutate state. */
export async function runPipelineDoctor(
  env: NodeJS.ProcessEnv = process.env,
): Promise<DoctorReport> {
  const findings: DoctorFinding[] = [];

  const packagerSecret = env.VMP_PACKAGER_SECRET?.trim() || '';
  if (!packagerSecret) {
    findings.push(finding('packager.secret', 'fatal', 'VMP_PACKAGER_SECRET is required'));
  } else if (!isBase64UrlSecret(packagerSecret)) {
    findings.push(
      finding(
        'packager.secret',
        'fatal',
        'VMP_PACKAGER_SECRET must be base64url (A–Z a–z 0–9 - _) for encore-packager Basic auth URL',
      ),
    );
  } else {
    findings.push(finding('packager.secret', 'ok', 'VMP_PACKAGER_SECRET set'));
  }

  const requireWebhook = env.VMP_REQUIRE_WEBHOOK_SECRET !== '0';
  if (requireWebhook && !env.VMP_WEBHOOK_SECRET?.trim()) {
    findings.push(
      finding(
        'webhook.secret',
        'fatal',
        'VMP_WEBHOOK_SECRET required (or set VMP_REQUIRE_WEBHOOK_SECRET=0)',
      ),
    );
  } else {
    findings.push(finding('webhook.secret', 'ok', 'Webhook secret policy OK'));
  }

  const uiHost = env.VMP_UI_HOST || '127.0.0.1';
  if (!isLoopbackHost(uiHost) && !env.VMP_SUPERVISOR_DASHBOARD_SECRET?.trim()) {
    findings.push(
      finding(
        'dashboard.secret',
        'fatal',
        `VMP_SUPERVISOR_DASHBOARD_SECRET required when VMP_UI_HOST=${uiHost}`,
      ),
    );
  } else {
    findings.push(finding('dashboard.secret', 'ok', 'Dashboard auth policy OK'));
  }

  const encoreBase = (env.ENCORE_BASE_URL || 'http://127.0.0.1:8080').trim();
  findings.push(finding('encore.url', 'ok', `ENCORE_BASE_URL=${encoreBase}`));
  const packagerEncoreBase = env.PACKAGER_ENCORE_BASE_URL?.trim() || '';
  if (packagerEncoreBase) {
    const normalizedPackagerEncoreBase = packagerEncoreBase.includes('://')
      ? packagerEncoreBase
      : `http://${packagerEncoreBase}`;
    try {
      new URL(normalizedPackagerEncoreBase);
      findings.push(
        finding(
          'encore.packager_url',
          'ok',
          `PACKAGER_ENCORE_BASE_URL=${redactUrlCredentials(normalizedPackagerEncoreBase)}`,
        ),
      );
    } catch {
      findings.push(finding('encore.packager_url', 'fatal', 'Invalid PACKAGER_ENCORE_BASE_URL'));
    }
  } else if (isLoopbackEncoreUrl(encoreBase)) {
    let dockerish = env.VMP_ASSUME_DOCKER === '1' || env.VMP_UI_HOST === '0.0.0.0';
    if (!dockerish) {
      try {
        await access('/.dockerenv', constants.F_OK);
        dockerish = true;
      } catch {
        dockerish = false;
      }
    }
    findings.push(
      finding(
        'encore.packager_url',
        'warn',
        dockerish
          ? 'ENCORE_BASE_URL is loopback; packager URLs will be rewritten to http://encore-web:8080 (set PACKAGER_ENCORE_BASE_URL to override)'
          : 'ENCORE_BASE_URL is loopback — if encore-packager runs in Docker, set PACKAGER_ENCORE_BASE_URL=http://encore-web:8080 (or host gateway URL)',
      ),
    );
  }

  if (env.VMP_PIPELINE_DOCTOR_SKIP_LIVE === '1') {
    findings.push(
      finding('encore.health', 'warn', 'Skipped live Encore check (VMP_PIPELINE_DOCTOR_SKIP_LIVE=1)'),
    );
    findings.push(
      finding('redis', 'warn', 'Skipped live Redis check (VMP_PIPELINE_DOCTOR_SKIP_LIVE=1)'),
    );
  } else {
    try {
      await checkEncoreHealth();
      findings.push(finding('encore.health', 'ok', 'Encore /actuator/health OK'));
    } catch (err) {
      findings.push(
        finding(
          'encore.health',
          'fatal',
          `Encore health failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }

    const redisUrl = (env.REDIS_URL || 'redis://127.0.0.1:6379').trim();
    findings.push(await checkRedis(redisUrl));
  }

  findings.push(...(await checkStorageConfigured(env)));

  const inboxFast = env.INBOX_FAST_LANE_DIR || '/media/videos/inbox-fast-lane';
  const inboxFull = env.INBOX_FULL_LADDER_DIR || '/media/videos/inbox-full-ladder';
  const tmpBase = env.TMP_DIR_BASE || '/media/tmp/video_pipeline';
  for (const [id, dir] of [
    ['inbox.fast', inboxFast],
    ['inbox.full', inboxFull],
    ['tmp', tmpBase],
  ] as const) {
    if (await pathWritable(dir)) {
      findings.push(finding(id, 'ok', `Writable ${dir}`));
    } else {
      findings.push(finding(id, 'fatal', `Not writable: ${dir}`));
    }
  }

  if (!env.VMP_API_BASE_URL?.trim() || !env.VMP_API_PIPELINE_SECRET?.trim()) {
    findings.push(
      finding(
        'api.callback',
        'warn',
        'VMP_API_BASE_URL / VMP_API_PIPELINE_SECRET unset — pipeline status callbacks to @vmp/api will be skipped',
      ),
    );
  } else {
    findings.push(finding('api.callback', 'ok', 'API pipeline callback configured'));
  }

  const ok = !findings.some((f) => f.severity === 'fatal');
  return { ok, findings };
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = report.findings.map((f) => {
    const tag = f.severity === 'ok' ? 'OK  ' : f.severity === 'warn' ? 'WARN' : 'FAIL';
    return `[${tag}] ${f.id}: ${f.message}`;
  });
  lines.push(report.ok ? 'Pipeline doctor: PASS' : 'Pipeline doctor: FAIL (fix fatal findings)');
  return lines.join('\n');
}

/** CLI entry when run as `node dist/pipelineDoctor.js`. */
export async function main(): Promise<void> {
  const report = await runPipelineDoctor(process.env);
  process.stdout.write(`${formatDoctorReport(report)}\n`);
  process.exitCode = report.ok ? 0 : 1;
}

const isDirectRun =
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
