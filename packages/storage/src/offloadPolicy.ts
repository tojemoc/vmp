import type { ObjectMetadata } from './types.js'

export interface OffloadPolicy {
  shouldOffload(meta: ObjectMetadata): boolean
}

/** Age-based eviction from hot tier — driven by app config, not provider lifecycle rules. */
export class AgeBasedOffloadPolicy implements OffloadPolicy {
  constructor(private readonly maxHotAgeSeconds: number) {}

  shouldOffload(meta: ObjectMetadata): boolean {
    const ageSeconds = (Date.now() - meta.lastModified.getTime()) / 1000
    return ageSeconds > this.maxHotAgeSeconds
  }
}
