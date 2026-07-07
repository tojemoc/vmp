import type { ObjectMetadata } from './types.js'

/** Merge object lists; first occurrence of each key wins (hot before cold). */
export function dedupeByKey(entries: ObjectMetadata[]): ObjectMetadata[] {
  const seen = new Set<string>()
  const out: ObjectMetadata[] = []
  for (const entry of entries) {
    if (seen.has(entry.key)) continue
    seen.add(entry.key)
    out.push(entry)
  }
  return out
}
