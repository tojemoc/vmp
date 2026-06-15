import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildSegmentAnalyticsSnapshot,
  buildSegmentAnalyticsSnapshotWithOptions,
  buildSegmentSessionKey,
  classifySegmentSource,
  computeEngagementScore,
  derivePlaybackPositionSeconds,
  logSegmentEvent,
  normalizeCountryCode,
} from '../src/adminExtras.js'

describe('country code normalization', () => {
  it('accepts valid ISO country codes', () => {
    assert.equal(normalizeCountryCode('sk'), 'SK')
    assert.equal(normalizeCountryCode(' CZ '), 'CZ')
  })

  it('rejects unknown or invalid country codes', () => {
    assert.equal(normalizeCountryCode('XX'), null)
    assert.equal(normalizeCountryCode('T1'), null)
    assert.equal(normalizeCountryCode(''), null)
    assert.equal(normalizeCountryCode('USA'), null)
  })
})

describe('engagement score', () => {
  it('weights retention and completion', () => {
    assert.equal(computeEngagementScore(80, 40), 70)
    assert.equal(computeEngagementScore(null, 40), null)
  })
})

describe('segment analytics source classification', () => {
  it('classifies campaign from UTM params', () => {
    const source = classifySegmentSource({
      referer: 'https://example.com/watch?v=1&utm_source=newsletter&utm_medium=email',
    })
    assert.equal(source.category, 'campaign')
    assert.equal(source.campaignSource, 'newsletter')
    assert.equal(source.campaignMedium, 'email')
  })

  it('classifies search/social/referral/direct', () => {
    assert.equal(classifySegmentSource({ referer: 'https://www.google.com/search?q=vmp' }).category, 'search')
    assert.equal(classifySegmentSource({ referer: 'https://t.co/xyz' }).category, 'social')
    assert.equal(classifySegmentSource({ referer: 'https://partner.example.net/article' }).category, 'referral')
    assert.equal(classifySegmentSource({ referer: '' }).category, 'direct')
  })

  it('falls back to direct for malformed referer values', () => {
    assert.equal(classifySegmentSource({ referer: 'not a url' }).category, 'direct')
  })
})

describe('segment playback + session derivation', () => {
  it('derives playback position from segment index and duration', () => {
    const playback = derivePlaybackPositionSeconds({ segmentIndex: 5, segmentDurationSeconds: 6.2 })
    assert.equal(playback, 31)
  })

  it('falls back to segment index when duration is unavailable', () => {
    const playback = derivePlaybackPositionSeconds({ segmentIndex: 8, segmentDurationSeconds: null })
    assert.equal(playback, 8)
  })

  it('builds stable session keys in 30-minute buckets', () => {
    const early = buildSegmentSessionKey({ videoId: 'vid-1', userId: 'u-1', timestampMs: 1_700_000_000_000 })
    const laterSameBucket = buildSegmentSessionKey({ videoId: 'vid-1', userId: 'u-1', timestampMs: 1_700_000_100_000 })
    const nextBucket = buildSegmentSessionKey({ videoId: 'vid-1', userId: 'u-1', timestampMs: 1_700_001_900_000 })
    assert.equal(early, laterSameBucket)
    assert.notEqual(early, nextBucket)
  })
})

describe('segment analytics persistence + snapshot', () => {
  function buildDbStub(resultsByMatch: Array<{ match: string, response: any }>, settings: Record<string, string> = {}) {
    return {
      prepare(sql: string) {
        if (sql.includes('admin_settings')) {
          return {
            values: [] as any[],
            bind(...args: any[]) {
              this.values = args
              return this
            },
            async first() {
              const key = String(this.values[0] ?? '')
              if (Object.prototype.hasOwnProperty.call(settings, key)) {
                return { value: settings[key] }
              }
              if (key === 'settings_changed_at') return { value: '1' }
              return null
            },
            async all() {
              const keys = this.values
              const results = keys
                .filter((key: string) => Object.prototype.hasOwnProperty.call(settings, key))
                .map((key: string) => ({ key, value: settings[key] }))
              return { results }
            },
          }
        }
        const matched = resultsByMatch.find((item) => sql.includes(item.match))
        return {
          bind() {
            return this
          },
          async first() {
            if (!matched) return null
            if (matched.response && Object.prototype.hasOwnProperty.call(matched.response, 'first')) {
              return matched.response.first
            }
            return null
          },
          async all() {
            if (!matched) return { results: [] }
            if (matched.response && Object.prototype.hasOwnProperty.call(matched.response, 'all')) {
              return matched.response.all
            }
            return { results: [] }
          },
        }
      },
    }
  }

  it('writes canonical source/session/position fields on event log', async () => {
    const captured: { sql: string; args: any[] }[] = []
    const env = {
      DB: {
        prepare(sql: string) {
          return {
            values: [] as any[],
            bind(...args: any[]) {
              this.values = args
              return this
            },
            async run() {
              captured.push({ sql, args: this.values })
              return { meta: { changes: 1 } }
            },
          }
        },
      },
    }
    await logSegmentEvent(env, {
      videoId: 'video-1',
      userId: null,
      requestPath: 'videos/video-1/segment-12.m4s',
      segmentIndex: 12,
      segmentDurationSeconds: 6,
      referer: 'https://news.example.com/post?utm_source=launch&utm_medium=social',
      ipHash: 'hash123',
      countryCode: 'SK',
      timestampMs: 1_700_000_000_000,
    })
    assert.ok(captured.length >= 1)
    const insert = captured.find((entry) => String(entry.sql).includes('INSERT INTO video_segment_events'))
    const args = insert?.args || []
    assert.equal(args[5], 12)
    assert.equal(args[10], 6)
    assert.equal(args[11], 72)
    assert.equal(args[13], 'campaign')
    assert.equal(args[15], 'launch')
    assert.equal(args[16], 'social')
    assert.equal(args[17], 'SK')
    assert.match(String(args[12]), /^video-1:i:hash123:/)
  })

  it('builds analytics snapshot from session-based aggregations', async () => {
    const db = buildDbStub([
      { match: 'COUNT(DISTINCT session_id) AS total', response: { first: { total: 4 } } },
      { match: 'COALESCE(source_category', response: { all: { results: [{ source: 'search', unique_sessions: 3 }, { source: 'direct', unique_sessions: 1 }] } } },
      { match: 'SELECT AVG(session_retention_pct) AS average_retention_percent', response: { first: { average_retention_percent: 55.5 } } },
      { match: 'per_video AS', response: { all: { results: [{ video_id: 'video-1', title: 'Test', slug: 'test', published_at: '2026-01-01', full_duration: 100, view_count: 2, average_retention_percent: 55.5, completion_rate_percent: 20, total_watch_seconds: 300 }] } } },
      { match: 'SELECT COALESCE(status, ', response: { all: { results: [{ status: 'active', count: 5 }] } } },
      { match: 'SELECT\n        bucket,\n        COUNT(DISTINCT session_id) AS unique_sessions', response: { all: { results: [] } } },
      { match: 'AS bucket,\n        SUM(COALESCE(segment_duration_seconds, 6)) AS total_watch_seconds', response: { all: { results: [{ bucket: '2026-04-01', total_watch_seconds: 600 }] } } },
      { match: 'SELECT SUM(COALESCE(segment_duration_seconds, 6)) AS total_watch_seconds\n      FROM video_segment_events\n      WHERE event_type = \'segment\'\n        AND datetime(created_at) >= datetime(?)', response: { first: { total_watch_seconds: 1200 } } },
      { match: 'SELECT COUNT(*) AS total\n      FROM video_segment_events', response: { first: { total: 42 } } },
      { match: 'SELECT\n        country_code AS country,\n        COUNT(DISTINCT session_id) AS unique_sessions', response: { all: { results: [{ country: 'SK', unique_sessions: 2 }] } } },
      { match: 'SELECT\n        country_code AS country,\n        SUM(COALESCE(segment_duration_seconds, 6)) AS total_watch_seconds', response: { all: { results: [{ country: 'SK', total_watch_seconds: 900 }] } } },
      { match: 'AS new_subscriptions', response: { all: { results: [] } } },
      { match: 'AS churned_subscriptions', response: { all: { results: [] } } },
      { match: 'AS expiring_subscriptions', response: { all: { results: [] } } },
      { match: 'SELECT plan_type, COUNT(*) AS active_count', response: { all: { results: [{ plan_type: 'monthly', active_count: 5 }] } } },
    ])
    const snapshot = await buildSegmentAnalyticsSnapshot(db)
    assert.equal(snapshot.totalViews, 4)
    assert.equal(snapshot.trafficSources[0].source, 'search')
    assert.equal(snapshot.kpis.averageRetentionPercent, 55.5)
    assert.equal(snapshot.videoStats[0].videoId, 'video-1')
    assert.equal(snapshot.videoStats[0].engagementScore, 47)
    assert.equal(snapshot.watchTime.totalSeconds, 1200)
    assert.equal(snapshot.countries.views[0].country, 'SK')
    assert.equal(snapshot.subscriptionsLegacy[0].status, 'active')
  })

  it('builds analytics snapshot with time-series options and overview sections', async () => {
    const env = {
      DB: buildDbStub([
        { match: 'COUNT(DISTINCT session_id) AS total', response: { first: { total: 9 } } },
        { match: 'COALESCE(source_category', response: { all: { results: [{ source: 'social', unique_sessions: 5 }] } } },
        { match: 'SELECT AVG(session_retention_pct) AS average_retention_percent', response: { first: { average_retention_percent: 42 } } },
        { match: 'per_video AS', response: { all: { results: [{ video_id: 'video-1', title: 'Test', slug: null, published_at: null, full_duration: 100, view_count: 4, average_retention_percent: 42, completion_rate_percent: 10, total_watch_seconds: 500 }] } } },
        { match: 'SELECT COALESCE(status, ', response: { all: { results: [{ status: 'active', count: 8 }] } } },
        { match: 'SELECT\n        bucket,\n        COUNT(DISTINCT session_id) AS unique_sessions', response: { all: { results: [{ bucket: '2026-04-01', unique_sessions: 3 }] } } },
        { match: 'AS bucket,\n        SUM(COALESCE(segment_duration_seconds, 6)) AS total_watch_seconds', response: { all: { results: [{ bucket: '2026-04-01', total_watch_seconds: 800 }] } } },
        { match: 'SELECT SUM(COALESCE(segment_duration_seconds, 6)) AS total_watch_seconds\n      FROM video_segment_events\n      WHERE event_type = \'segment\'\n        AND datetime(created_at) >= datetime(?)', response: { first: { total_watch_seconds: 2400 } } },
        { match: 'SELECT COUNT(*) AS total\n      FROM video_segment_events', response: { first: { total: 99 } } },
        { match: 'SELECT\n        country_code AS country,\n        COUNT(DISTINCT session_id) AS unique_sessions', response: { all: { results: [{ country: 'CZ', unique_sessions: 1 }] } } },
        { match: 'SELECT\n        country_code AS country,\n        SUM(COALESCE(segment_duration_seconds, 6)) AS total_watch_seconds', response: { all: { results: [{ country: 'CZ', total_watch_seconds: 700 }] } } },
        { match: 'AS new_subscriptions', response: { all: { results: [{ bucket: '2026-04-01', new_subscriptions: 2 }] } } },
        { match: 'AS churned_subscriptions', response: { all: { results: [{ bucket: '2026-04-01', churned_subscriptions: 1 }] } } },
        { match: 'AS expiring_subscriptions', response: { all: { results: [{ bucket: '2026-04-01', expiring_subscriptions: 1 }] } } },
        { match: 'SELECT plan_type, COUNT(*) AS active_count', response: { all: { results: [{ plan_type: 'monthly', active_count: 6 }] } } },
      ], {
        monthly_price_eur: '12',
        yearly_price_eur: '120',
        club_price_eur: '30',
        analytics_view_min_segments: '1',
        analytics_view_min_watch_seconds: '15',
        settings_changed_at: '1',
      }),
    }
    const snapshot = await buildSegmentAnalyticsSnapshotWithOptions(env.DB, env, {
      range: '30d',
      granularity: 'day',
      dataset: 'all',
      format: 'json',
    })
    assert.equal(snapshot.kpis.totalUniqueViews, 9)
    assert.equal(snapshot.kpis.totalWatchSeconds, 2400)
    assert.equal(snapshot.kpis.segmentRequests, 99)
    assert.equal(snapshot.trafficSources[0].source, 'social')
    assert.equal(snapshot.views.series[0].bucket, '2026-04-01')
    assert.equal(snapshot.watchTime.series[0].totalWatchSeconds, 800)
    assert.equal(snapshot.subscriptionOverview.statusBreakdown[0].status, 'active')
    assert.equal(snapshot.subscriptionOverview.trends[0].newSubscriptions, 2)
    assert.equal(snapshot.cashflow.trend[0].estimatedNetNewEur, 12)
  })
})
