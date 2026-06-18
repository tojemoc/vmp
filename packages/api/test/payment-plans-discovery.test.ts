import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseAllowedPlanSlugs } from '../src/paymentProcessor.js'

describe('parseAllowedPlanSlugs', () => {
  it('returns core plans by default', () => {
    assert.deepEqual(parseAllowedPlanSlugs('monthly,yearly,club'), ['monthly', 'yearly', 'club'])
  })

  it('includes custom plans from allowed_plans', () => {
    assert.deepEqual(parseAllowedPlanSlugs('monthly,yearly,club,family'), ['monthly', 'yearly', 'club', 'family'])
  })

  it('does not infer feature-flag slugs from unrelated admin_settings keys', () => {
    const slugs = parseAllowedPlanSlugs('monthly,yearly,club')
    assert.equal(slugs.includes('pills'), false)
    assert.equal(slugs.includes('promotions'), false)
    assert.equal(slugs.includes('rss_free_preview'), false)
    assert.equal(slugs.includes('analytics_ga4'), false)
  })
})
