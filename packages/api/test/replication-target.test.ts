import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  REPLICATION_INGEST_PATH,
  assertReplicationIngestAccepted,
  describeReplicationTarget,
  parseReplicationIngestResponse,
  replicationTargetProbeHint,
  resolveReplicationTargetUrl,
} from '../src/replicationTarget.js'

describe('resolveReplicationTargetUrl', () => {
  it('appends ingest path when only origin is set', () => {
    assert.equal(
      resolveReplicationTargetUrl('https://vmp-api-node.deno.dev'),
      `https://vmp-api-node.deno.dev${REPLICATION_INGEST_PATH}`,
    )
  })

  it('preserves full ingest URL', () => {
    const url = `https://vmp-api-node.deno.dev${REPLICATION_INGEST_PATH}`
    assert.equal(resolveReplicationTargetUrl(url), url)
  })

  it('fixes /api/internal/replication without /ingest', () => {
    assert.equal(
      resolveReplicationTargetUrl('https://backup.example/api/internal/replication'),
      `https://backup.example${REPLICATION_INGEST_PATH}`,
    )
  })
})

describe('describeReplicationTarget', () => {
  it('warns when host is workers.dev', () => {
    const info = describeReplicationTarget('https://vmp-api.foo.workers.dev')
    assert.equal(info.configured, true)
    assert.match(info.warning ?? '', /Workers/i)
  })
})

describe('parseReplicationIngestResponse', () => {
  it('parses applied and errors', () => {
    const result = parseReplicationIngestResponse(
      JSON.stringify({ ok: true, applied: 2, skipped: 1, errors: [] }),
    )
    assert.equal(result.applied, 2)
    assert.equal(result.skipped, 1)
    assert.equal(result.errors.length, 0)
  })
})

describe('assertReplicationIngestAccepted', () => {
  it('throws when all events skipped', () => {
    assert.throws(() => {
      assertReplicationIngestAccepted({ ok: true, applied: 0, skipped: 3, errors: [] }, 3)
    }, /skipped all/)
  })
})

describe('replicationTargetProbeHint', () => {
  it('detects worker 404', () => {
    const hint = replicationTargetProbeHint(404, JSON.stringify({ error: 'Not Found' }))
    assert.match(hint ?? '', /404/)
  })
})
