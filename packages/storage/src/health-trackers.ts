import type { PrimaryHealthTracker } from './types.js'

export function createAlwaysHealthyTracker(): PrimaryHealthTracker {
  return {
    async isHealthy() {
      return true
    },
    async recordFailure() {},
    async recordSuccess() {},
  }
}

export function createNoOpTracker(): PrimaryHealthTracker {
  return createAlwaysHealthyTracker()
}
