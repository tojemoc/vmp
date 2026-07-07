import type { ListedObject } from './types.js'

/** Merge object lists; first occurrence of each key wins (hot before cold). */
export function dedupeByKey(entries: ListedObject[]): ListedObject[] {
  const seen = new Set<string>()
  const out: ListedObject[] = []
  for (const entry of entries) {
    if (seen.has(entry.key)) continue
    seen.add(entry.key)
    out.push(entry)
  }
  return out
}
