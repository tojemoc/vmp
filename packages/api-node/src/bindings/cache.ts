/**
 * In-memory LRU Cache polyfill for `caches.default` used by RSS feed handlers.
 */

const MAX_ENTRIES = 256

interface CacheEntry {
  response: Response
  expiresAt: number
}

class MemoryCache {
  private readonly store = new Map<string, CacheEntry>()

  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    const key = this.keyFor(request)
    const entry = this.store.get(key)
    if (!entry) return undefined
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key)
      return undefined
    }
    this.store.delete(key)
    this.store.set(key, entry)
    return entry.response.clone()
  }

  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    const key = this.keyFor(request)
    if (this.store.has(key)) {
      this.store.delete(key)
    }
    if (this.store.size >= MAX_ENTRIES) {
      const first = this.store.keys().next().value
      if (first) this.store.delete(first)
    }
    const cacheControl = response.headers.get('Cache-Control') ?? ''
    const maxAgeMatch = /max-age=(\d+)/i.exec(cacheControl)
    const ttlMs = maxAgeMatch ? Number.parseInt(maxAgeMatch[1]!, 10) * 1000 : 300_000
    this.store.set(key, {
      response: response.clone(),
      expiresAt: Date.now() + ttlMs,
    })
  }

  async delete(request: RequestInfo | URL): Promise<boolean> {
    return this.store.delete(this.keyFor(request))
  }

  async keys(): Promise<readonly Request[]> {
    return [...this.store.keys()].map((u) => new Request(u))
  }

  private keyFor(request: RequestInfo | URL): string {
    if (typeof request === 'string') return request
    if (request instanceof URL) return request.toString()
    return request.url
  }
}

let installed = false

export function installCachePolyfill(): void {
  if (installed) return
  installed = true
  const cache = new MemoryCache()
  const globalCaches = globalThis as typeof globalThis & { caches?: CacheStorage & { default?: Cache } }
  if (!globalCaches.caches) {
    globalCaches.caches = {
      default: cache,
      open: async () => cache,
      has: async () => true,
      delete: async () => true,
      keys: async () => ['default'],
      match: async () => undefined,
    } as unknown as CacheStorage & { default: Cache }
  } else {
    ;(globalCaches.caches as CacheStorage & { default: Cache }).default = cache as unknown as Cache
  }
}
