import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseAllowedPlanSlugs } from '../src/paymentProcessor.js'

const CORE = ['monthly', 'yearly', 'club']

describe('parseAllowedPlanSlugs', () => {
  it('returns core plans for a normal allowed_plans string', () => {
    assert.deepEqual(parseAllowedPlanSlugs('monthly,yearly,club'), CORE)
  })

  it('includes custom plans from allowed_plans', () => {
    assert.deepEqual(parseAllowedPlanSlugs('monthly,yearly,club,family'), [...CORE, 'family'])
  })

  it('defaults to core plans for null and undefined', () => {
    assert.deepEqual(parseAllowedPlanSlugs(null), CORE)
    assert.deepEqual(parseAllowedPlanSlugs(undefined), CORE)
  })

  it('returns only core plans for an empty string', () => {
    assert.deepEqual(parseAllowedPlanSlugs(''), CORE)
  })

  it('filters invalid slug tokens from the CSV', () => {
    const slugs = parseAllowedPlanSlugs('monthly,123invalid,special-char,!,')
    assert.deepEqual(slugs, CORE)
  })

  it('lowercases valid slug tokens before accepting them', () => {
    assert.deepEqual(parseAllowedPlanSlugs('monthly,FAMILY'), [...CORE, 'family'])
  })

  it('deduplicates slug entries', () => {
    assert.deepEqual(parseAllowedPlanSlugs('monthly,monthly,yearly,club'), CORE)
  })

  it('trims whitespace around slug values', () => {
    assert.deepEqual(parseAllowedPlanSlugs(' monthly , yearly , club , family '), [...CORE, 'family'])
  })
})
