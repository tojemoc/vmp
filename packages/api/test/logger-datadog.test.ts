import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDatadogIntakeUrl,
  buildDatadogLogBatch,
  isDatadogLogsEnabled,
  normalizeDatadogSite,
} from '../src/logger.js'

describe('Datadog worker log helpers', () => {
  it('isDatadogLogsEnabled requires explicit opt-in and API key', () => {
    assert.equal(isDatadogLogsEnabled({}), false)
    assert.equal(isDatadogLogsEnabled({ DD_API_KEY: 'secret' }), false)
    assert.equal(isDatadogLogsEnabled({ DD_LOGS_ENABLED: 'true' }), false)
    assert.equal(isDatadogLogsEnabled({ DD_LOGS_ENABLED: 'true', DD_API_KEY: 'secret' }), true)
    assert.equal(isDatadogLogsEnabled({ DD_LOGS_ENABLED: '1', DD_API_KEY: 'secret' }), true)
  })

  it('normalizeDatadogSite defaults to EU', () => {
    assert.equal(normalizeDatadogSite(''), 'datadoghq.eu')
    assert.equal(normalizeDatadogSite('datadoghq.eu'), 'datadoghq.eu')
    assert.equal(normalizeDatadogSite('us3.datadoghq.com'), 'us3.datadoghq.com')
  })

  it('buildDatadogIntakeUrl targets the EU v2 endpoint by default', () => {
    assert.equal(
      buildDatadogIntakeUrl({}),
      'https://http-intake.logs.datadoghq.eu/api/v2/logs',
    )
    assert.equal(
      buildDatadogIntakeUrl({ DD_SITE: 'datadoghq.com' }),
      'https://http-intake.logs.datadoghq.com/api/v2/logs',
    )
  })

  it('buildDatadogLogBatch maps structured entries for the HTTP API', () => {
    const batch = buildDatadogLogBatch([
      {
        service: 'auth',
        event: 'magic_link_sent',
        level: 'warn',
        ts: '2026-06-25T12:00:00.000Z',
      },
    ], {
      DD_SERVICE: 'vmp-api',
      DD_ENV: 'staging',
    })

    assert.equal(batch.length, 1)
    assert.equal(batch[0].ddsource, 'cloudflare-worker')
    assert.equal(batch[0].service, 'vmp-api')
    assert.equal(batch[0].status, 'warn')
    assert.equal(batch[0].ddtags, 'env:staging')
    assert.match(batch[0].message, /magic_link_sent/)
  })
})
