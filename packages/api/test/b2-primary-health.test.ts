import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  B2_FAILURE_THRESHOLD,
  B2PrimaryHealthDOBase,
} from '../src/b2PrimaryHealth.js'

function createDo(): B2PrimaryHealthDOBase {
  const storage = new Map<string, unknown>()
  const state = {
    storage: {
      async get<T>(key: string): Promise<T | undefined> {
        return storage.get(key) as T | undefined
      },
      async put(key: string, value: unknown): Promise<void> {
        storage.set(key, value)
      },
    },
  } as DurableObjectState
  return new B2PrimaryHealthDOBase(state)
}

describe('B2PrimaryHealthDO', () => {
  it('opens circuit after consecutive failures', async () => {
    const doInstance = createDo()
    assert.equal(await doInstance.isHealthy(), true)
    for (let i = 0; i < B2_FAILURE_THRESHOLD; i++) {
      await doInstance.recordFailure()
    }
    assert.equal(await doInstance.isHealthy(), false)
  })

  it('resets on success', async () => {
    const doInstance = createDo()
    for (let i = 0; i < B2_FAILURE_THRESHOLD; i++) {
      await doInstance.recordFailure()
    }
    await doInstance.recordSuccess()
    assert.equal(await doInstance.isHealthy(), true)
  })

  it('re-extends cooldown when failures continue after cooldown elapsed', async () => {
    const doInstance = createDo()
    await doInstance.state.storage.put('health', {
      consecutiveFailures: B2_FAILURE_THRESHOLD,
      openedAt: Date.now() - 61_000,
    })
    assert.equal(await doInstance.isHealthy(), true)

    await doInstance.recordFailure()
    assert.equal(await doInstance.isHealthy(), false)
  })
})
