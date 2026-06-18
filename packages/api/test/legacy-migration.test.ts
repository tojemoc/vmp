/**
 * Legacy migration admin tooling.
 * Run: npm test --workspace=@vmp/api
 */
import { describe, it, mock, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  interpretLegacyValidationResponse,
} from '../src/legacyProvider.js'
import {
  getMigrationStats as getMigrationStatsFromModule,
  validateLegacyBatch as validateLegacyBatchFromModule,
  getRelinkCandidates as getRelinkCandidatesFromModule,
} from '../src/legacyMigration.js'

function createMockDb(rows: Record<string, unknown>[]) {
  return {
    prepare(sql: string) {
      const query = sql.replace(/\s+/g, ' ').trim().toLowerCase()
      const binds: unknown[] = []
      const stmt = {
        bind(...args: unknown[]) {
          binds.push(...args)
          return stmt
        },
        async first() {
          if (query.includes('sum(case when provider')) {
            const legacy = rows.filter((r) => r.provider === 'legacy')
            return {
              total_imported: legacy.length,
              needs_relink: legacy.filter((r) => r.status === 'needs_relink').length,
              active: legacy.filter((r) => r.status === 'active' || r.status === 'trialing').length,
              failed: legacy.filter((r) => r.legacy_validation_status === 'invalid').length,
              not_validated: legacy.filter((r) => r.status === 'needs_relink' && r.legacy_validation_status == null).length,
            }
          }
          if (query.includes('count(*) as n')) {
            const staleModifier = binds[0]
            const staleDays = staleModifier != null
              ? Number.parseInt(String(staleModifier).replace(/[^\d]/g, ''), 10) || 0
              : 0
            const cutoff = staleDays > 0 ? Date.now() - staleDays * 86_400_000 : null
            const matched = rows.filter((r) => {
              if (r.legacy_validation_status === 'invalid' && r.provider === 'legacy') return true
              if (r.status === 'needs_relink') {
                if (!cutoff) return true
                if (r.created_at) return new Date(String(r.created_at)).getTime() <= cutoff
              }
              return false
            })
            return { n: matched.length }
          }
          return null
        },
        async all() {
          if (query.includes('legacy_validation_status is null') && query.includes('needs_relink')) {
            const limit = Number(binds[0] ?? 25)
            const matched = rows.filter((r) =>
              r.provider === 'legacy' &&
              r.status === 'needs_relink' &&
              r.legacy_validation_status == null &&
              r.purchase_id,
            )
            return { results: matched.slice(0, limit) }
          }
          if (query.includes('join users')) {
            const limit = binds[binds.length - 2]
            const offset = binds[binds.length - 1]
            const staleModifier = binds.length > 2 ? binds[0] : null
            const staleDays = staleModifier != null
              ? Number.parseInt(String(staleModifier).replace(/[^\d]/g, ''), 10) || 0
              : 0
            const cutoff = staleDays > 0 ? Date.now() - staleDays * 86_400_000 : null
            const matched = rows
              .filter((r) => {
                if (r.legacy_validation_status === 'invalid' && r.provider === 'legacy') return true
                if (r.status === 'needs_relink') {
                  if (!cutoff) return true
                  if (r.created_at) return new Date(String(r.created_at)).getTime() <= cutoff
                }
                return false
              })
              .map((r) => ({
                user_id: r.user_id,
                email: r.email,
                provider: r.provider,
                purchase_id: r.purchase_id,
                stripe_customer_id: r.stripe_customer_id,
                legacy_validation_status: r.legacy_validation_status,
                legacy_validated_at: r.legacy_validated_at,
                created_at: r.created_at,
              }))
            const start = Number(offset ?? 0)
            const end = start + Number(limit ?? 25)
            return { results: matched.slice(start, end) }
          }
          return { results: [] }
        },
        async run() {
          return { success: true }
        },
      }
      return stmt
    },
    async batch() {
      return []
    },
  }
}

describe('interpretLegacyValidationResponse', () => {
  it('marks 2xx as valid', () => {
    const result = interpretLegacyValidationResponse(200, {})
    assert.equal(result.result, 'valid')
  })

  it('marks cardOnFile 400 as invalid', () => {
    const result = interpretLegacyValidationResponse(400, {
      message: 'Missing or invalid cardOnFile',
      reason: 'cardOnFile',
    })
    assert.equal(result.result, 'invalid')
  })
})

describe('getMigrationStats', () => {
  it('returns correct counts from mixed rows', async () => {
    const db = createMockDb([
      { provider: 'legacy', status: 'needs_relink', legacy_validation_status: null },
      { provider: 'legacy', status: 'needs_relink', legacy_validation_status: 'invalid' },
      { provider: 'legacy', status: 'active', legacy_validation_status: 'valid' },
      { provider: 'stripe', status: 'active', legacy_validation_status: null },
    ]) as any
    const env = {
      LEGACY_ESHOP_API_URL: 'https://legacy-api.example.com/api/v2/eshop',
      FRONTEND_URL: 'https://app.example.com',
      API_URL: 'https://api.example.com',
    }
    const stats = await getMigrationStatsFromModule(db, env)
    assert.equal(stats.total_imported, 3)
    assert.equal(stats.needs_relink, 2)
    assert.equal(stats.active, 1)
    assert.equal(stats.failed, 1)
    assert.equal(stats.not_validated, 1)
    assert.equal(stats.churn_rate_pct, 50)
  })
})

describe('validateLegacyBatch', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('marks rows valid when probe returns 200', async () => {
    globalThis.fetch = mock.fn(async () => new Response(JSON.stringify({
      gatewayLink: 'https://legacy-sandbox.example.com/pay',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const rows = [
      {
        id: 'sub-1',
        user_id: 'user-1',
        provider: 'legacy',
        status: 'needs_relink',
        purchase_id: 'token-1',
        plan_type: 'monthly',
        legacy_validation_status: null,
      },
    ]
    const db = createMockDb(rows) as any
    const env = {
      LEGACY_ESHOP_API_URL: 'https://legacy-api.example.com/api/v2/eshop',
      LEGACY_ESHOP_MERCHANT_ID: 'merchant',
      LEGACY_ESHOP_API_KEY: 'secret',
      FRONTEND_URL: 'https://app.example.com',
      API_URL: 'https://api.example.com',
    }
    const result = await validateLegacyBatchFromModule(db, env, 10, false, 'production')
    assert.equal(result.processed, 1)
    assert.equal(result.valid, 1)
    assert.equal(result.invalid, 0)
  })

  it('marks rows invalid when probe returns cardOnFile 400', async () => {
    globalThis.fetch = mock.fn(async () => new Response(JSON.stringify({
      message: 'Missing or invalid cardOnFile',
      reason: 'cardOnFile',
    }), { status: 400, headers: { 'Content-Type': 'application/json' } }))

    const rows = [
      {
        id: 'sub-2',
        user_id: 'user-2',
        provider: 'legacy',
        status: 'needs_relink',
        purchase_id: '10856892',
        plan_type: 'monthly',
        legacy_validation_status: null,
      },
    ]
    const db = createMockDb(rows) as any
    const env = {
      LEGACY_ESHOP_API_URL: 'https://legacy-api.example.com/api/v2/eshop',
      LEGACY_ESHOP_MERCHANT_ID: 'merchant',
      LEGACY_ESHOP_API_KEY: 'secret',
      FRONTEND_URL: 'https://app.example.com',
      API_URL: 'https://api.example.com',
    }
    const result = await validateLegacyBatchFromModule(db, env, 10, false, 'production')
    assert.equal(result.invalid, 1)
    assert.equal(result.details[0]?.result, 'invalid')
  })

  it('dryRun makes no DB writes', async () => {
    let updateCalls = 0
    const rows = [
      {
        id: 'sub-3',
        user_id: 'user-3',
        provider: 'legacy',
        status: 'needs_relink',
        purchase_id: 'token-3',
        plan_type: 'monthly',
        legacy_validation_status: null,
      },
    ]
    const baseDb = createMockDb(rows) as any
    const db = {
      ...baseDb,
      prepare(sql: string) {
        const stmt = baseDb.prepare(sql)
        return {
          ...stmt,
          async run() {
            if (sql.toLowerCase().includes('legacy_validation_status')) {
              updateCalls += 1
            }
            return { success: true }
          },
        }
      },
    }
    globalThis.fetch = mock.fn(async () => new Response(JSON.stringify({}), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    }))
    const env = {
      LEGACY_ESHOP_API_URL: 'https://legacy-api.example.com/api/v2/eshop',
      LEGACY_ESHOP_MERCHANT_ID: 'merchant',
      LEGACY_ESHOP_API_KEY: 'secret',
      FRONTEND_URL: 'https://app.example.com',
      API_URL: 'https://api.example.com',
    }
    await validateLegacyBatchFromModule(db as any, env, 10, true, 'production')
    assert.equal(updateCalls, 0)
  })
})

describe('getRelinkCandidates', () => {
  it('includes all needs_relink rows and invalid legacy rows', async () => {
    const oldDate = new Date(Date.now() - 40 * 86_400_000).toISOString()
    const db = createMockDb([
      {
        user_id: 'u1',
        email: 'alpha@example.com',
        provider: 'legacy',
        status: 'needs_relink',
        purchase_id: 'p1',
        legacy_validation_status: 'invalid',
        legacy_validated_at: '2026-01-01',
        created_at: oldDate,
      },
      {
        user_id: 'u2',
        email: 'beta@example.com',
        provider: 'legacy',
        status: 'needs_relink',
        purchase_id: 'p2',
        legacy_validation_status: null,
        legacy_validated_at: null,
        created_at: oldDate,
      },
      {
        user_id: 'u3',
        email: 'gamma@example.com',
        provider: 'legacy',
        status: 'needs_relink',
        purchase_id: 'p3',
        legacy_validation_status: null,
        legacy_validated_at: null,
        created_at: new Date().toISOString(),
      },
      {
        user_id: 'u4',
        email: 'delta@example.com',
        provider: 'stripe',
        status: 'needs_relink',
        purchase_id: null,
        stripe_customer_id: 'import-list:ml-1',
        legacy_validation_status: null,
        legacy_validated_at: null,
        created_at: new Date().toISOString(),
      },
    ]) as any

    const result = await getRelinkCandidatesFromModule(db, 1, 25, 0)
    assert.equal(result.total, 4)
    assert.equal(result.users.length, 4)
    assert.equal(result.users[0]?.validationStatus, 'invalid')
    assert.ok(result.users.some((u) => u.provider === 'stripe'))
  })

  it('can limit needs_relink to stale imports when staleDays is set', async () => {
    const oldDate = new Date(Date.now() - 40 * 86_400_000).toISOString()
    const db = createMockDb([
      {
        user_id: 'u2',
        email: 'beta@example.com',
        provider: 'legacy',
        status: 'needs_relink',
        purchase_id: 'p2',
        legacy_validation_status: null,
        legacy_validated_at: null,
        created_at: oldDate,
      },
      {
        user_id: 'u3',
        email: 'gamma@example.com',
        provider: 'legacy',
        status: 'needs_relink',
        purchase_id: 'p3',
        legacy_validation_status: null,
        legacy_validated_at: null,
        created_at: new Date().toISOString(),
      },
    ]) as any

    const result = await getRelinkCandidatesFromModule(db, 1, 25, 30)
    assert.equal(result.total, 1)
    assert.equal(result.users.length, 1)
    assert.equal(result.users[0]?.userId, 'u2')
  })
})
