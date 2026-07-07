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

/** Used when B2 is not configured — reads never consult health state. */
export function createNoOpTracker(): PrimaryHealthTracker {
  return createAlwaysHealthyTracker()
}
