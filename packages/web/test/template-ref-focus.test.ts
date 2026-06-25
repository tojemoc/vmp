import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { firstTemplateRef, focusAndSelectTemplateRef } from '../utils/templateRefFocus'

function focusable() {
  return {
    focused: 0,
    selected: 0,
    focus() {
      this.focused += 1
    },
    select() {
      this.selected += 1
    },
  }
}

describe('firstTemplateRef', () => {
  it('returns a single template ref value', () => {
    const input = focusable()

    assert.equal(firstTemplateRef(input), input)
  })

  it('returns the first populated value from a Vue v-for template ref array', () => {
    const input = focusable()

    assert.equal(firstTemplateRef([null, input]), input)
  })
})

describe('focusAndSelectTemplateRef', () => {
  it('focuses and selects a single input ref', () => {
    const input = focusable()

    assert.equal(focusAndSelectTemplateRef(input), true)
    assert.equal(input.focused, 1)
    assert.equal(input.selected, 1)
  })

  it('focuses and selects the populated input when Vue provides an array ref', () => {
    const input = focusable()

    assert.equal(focusAndSelectTemplateRef([undefined, input]), true)
    assert.equal(input.focused, 1)
    assert.equal(input.selected, 1)
  })

  it('does nothing when no ref is mounted yet', () => {
    assert.equal(focusAndSelectTemplateRef(null), false)
    assert.equal(focusAndSelectTemplateRef([]), false)
  })
})
