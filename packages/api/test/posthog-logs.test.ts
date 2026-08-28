import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildPostHogLogsUrl,
  buildPostHogOtlpPayload,
  formatPostHogLogBody,
  isPostHogLogsEnabled,
} from '../src/posthogLogs.js';

describe('PostHog worker log helpers', () => {
  it('isPostHogLogsEnabled requires project token and allows opt-out', () => {
    assert.equal(isPostHogLogsEnabled({}), false);
    assert.equal(isPostHogLogsEnabled({ POSTHOG_PROJECT_TOKEN: 'phc_test' }), true);
    assert.equal(
      isPostHogLogsEnabled({ POSTHOG_PROJECT_TOKEN: 'phc_test', POSTHOG_LOGS_ENABLED: 'false' }),
      false,
    );
    assert.equal(
      isPostHogLogsEnabled({ POSTHOG_PROJECT_TOKEN: 'phc_test', POSTHOG_LOGS_ENABLED: 'true' }),
      true,
    );
  });

  it('buildPostHogLogsUrl targets the EU logs endpoint by default', () => {
    assert.equal(
      buildPostHogLogsUrl({ POSTHOG_HOST: 'https://eu.i.posthog.com' }),
      'https://eu.i.posthog.com/i/v1/logs',
    );
  });

  it('formatPostHogLogBody mirrors structured worker summaries', () => {
    assert.equal(
      formatPostHogLogBody({
        service: 'worker',
        event: 'request',
        level: 'info',
        http_method: 'GET',
        http_path: '/api/videos',
        http_status: 200,
        duration_ms: 12,
        ts: '2026-06-25T08:40:05.704Z',
      }),
      'worker: GET /api/videos → 200 request 12ms',
    );
  });

  it('buildPostHogOtlpPayload maps entries to OTLP JSON with tracing attributes', () => {
    const payload = buildPostHogOtlpPayload(
      [
        {
          service: 'auth',
          event: 'magic_link_sent',
          level: 'warn',
          ts: '2026-06-25T12:00:00.000Z',
        },
      ],
      {
        POSTHOG_PROJECT_TOKEN: 'phc_test',
        SENTRY_ENVIRONMENT: 'staging',
        DD_SERVICE: 'vmp-api',
      },
      { distinctId: 'user_1', sessionId: 'sess_abc' },
    );

    const resourceLogs = payload.resourceLogs as Array<Record<string, unknown>>;
    assert.equal(resourceLogs.length, 1);
    const resource = resourceLogs[0].resource as { attributes: Array<{ key: string }> };
    assert.ok(resource.attributes.some((attr) => attr.key === 'service.name'));
    assert.ok(resource.attributes.some((attr) => attr.key === 'deployment.environment'));

    const scopeLogs = resourceLogs[0].scopeLogs as Array<Record<string, unknown>>;
    const logRecords = scopeLogs[0].logRecords as Array<Record<string, unknown>>;
    assert.equal(logRecords.length, 1);
    assert.equal(logRecords[0].severityText, 'WARN');
    assert.equal(logRecords[0].severityNumber, 13);
    const body = logRecords[0].body as { stringValue: string };
    assert.equal(body.stringValue, 'auth: magic_link_sent');

    const attributes = logRecords[0].attributes as Array<{ key: string; value: Record<string, unknown> }>;
    const keys = attributes.map((attr) => attr.key);
    assert.ok(keys.includes('posthogDistinctId'));
    assert.ok(keys.includes('sessionId'));
    assert.ok(keys.includes('event'));
    assert.ok(keys.includes('component'));
    const distinctId = attributes.find((attr) => attr.key === 'posthogDistinctId');
    assert.equal(distinctId?.value.stringValue, 'user_1');
  });
});
