import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDatadogIntakeUrl,
  buildDatadogLogBatch,
  isDatadogLogsEnabled,
  log,
  normalizeDatadogSite,
  runWithDatadogLogContext,
  setDatadogFlushHandlerForTests,
} from '../src/logger.js'

function makeExecutionContext() {
  const waitUntilTasks: Promise<unknown>[] = []
  const ctx = {
    waitUntil(task: Promise<unknown>) {
      waitUntilTasks.push(task)
    },
  } as ExecutionContext
  return { ctx, waitUntilTasks }
}

const datadogEnv = {
  DD_LOGS_ENABLED: 'true',
  DD_API_KEY: 'test-key',
  DD_SERVICE: 'vmp-api',
}

describe('Datadog worker log helpers', () => {
  afterEach(() => {
    setDatadogFlushHandlerForTests(null)
  })

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

  it('buffers logs during runWithDatadogLogContext and flushes on completion', async () => {
    const flushed: Array<{ env: Record<string, unknown>; events: string[] }> = []
    setDatadogFlushHandlerForTests(async (env, entries) => {
      flushed.push({
        env,
        events: entries.map((entry) => String(entry.event)),
      })
    })

    const { ctx, waitUntilTasks } = makeExecutionContext()
    await runWithDatadogLogContext(datadogEnv, ctx, async () => {
      log({ service: 'auth', event: 'magic_link_sent' })
      log({ service: 'worker', event: 'request' })
    })
    await Promise.all(waitUntilTasks)

    assert.equal(flushed.length, 1)
    assert.deepEqual(flushed[0].events, ['magic_link_sent', 'request'])
    assert.equal(flushed[0].env.DD_SERVICE, 'vmp-api')
  })

  it('does not flush when Datadog logging is disabled', async () => {
    const flushed: string[][] = []
    setDatadogFlushHandlerForTests(async (_env, entries) => {
      flushed.push(entries.map((entry) => String(entry.event)))
    })

    const { ctx, waitUntilTasks } = makeExecutionContext()
    await runWithDatadogLogContext({ DD_LOGS_ENABLED: 'false', DD_API_KEY: 'test-key' }, ctx, async () => {
      log({ service: 'auth', event: 'ignored' })
    })
    await Promise.all(waitUntilTasks)

    assert.deepEqual(flushed, [])
  })

  it('isolates overlapping invocations so batches are not mixed', async () => {
    const flushed: Array<{ service: string; events: string[] }> = []
    setDatadogFlushHandlerForTests(async (env, entries) => {
      flushed.push({
        service: String(env.DD_SERVICE ?? ''),
        events: entries.map((entry) => String(entry.event)),
      })
    })

    let releaseA!: () => void
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve
    })

    const { ctx: ctxA, waitUntilTasks: waitA } = makeExecutionContext()
    const { ctx: ctxB, waitUntilTasks: waitB } = makeExecutionContext()

    const runA = runWithDatadogLogContext(datadogEnv, ctxA, async () => {
      log({ service: 'a', event: 'a-before' })
      await gateA
      log({ service: 'a', event: 'a-after' })
    })

    const runB = runWithDatadogLogContext(
      { ...datadogEnv, DD_SERVICE: 'vmp-api-b' },
      ctxB,
      async () => {
        log({ service: 'b', event: 'b-only' })
        releaseA()
      },
    )

    await Promise.all([runA, runB])
    await Promise.all([...waitA, ...waitB])

    assert.equal(flushed.length, 2)
    const batchB = flushed.find((batch) => batch.service === 'vmp-api-b')
    const batchA = flushed.find((batch) => batch.service === 'vmp-api')
    assert.ok(batchB)
    assert.ok(batchA)
    assert.deepEqual(batchB.events, ['b-only'])
    assert.deepEqual(batchA.events, ['a-before', 'a-after'])
  })
})
