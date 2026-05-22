import type { DurableObjectIdStub, DurableObjectNamespaceStub, DurableObjectStub } from '../types.js'

interface SegmentRateLimitBody {
  identifier?: string
  videoId?: string
  avgSegDur?: number | null
}

/**
 * In-memory segment rate limiter replacing Cloudflare Durable Objects.
 * State resets on process restart (acceptable degradation in failover mode).
 */
export class InMemorySegmentRateLimiter {
  private readonly counts = new Map<string, number>()

  async handle(body: SegmentRateLimitBody): Promise<{ count: number; threshold: number; exceeded: boolean }> {
    const identifier = body.identifier ?? 'unknown'
    const videoId = body.videoId ?? 'unknown'
    const avgSegDur = body.avgSegDur ?? null
    const segDur =
      typeof avgSegDur === 'number' && Number.isFinite(avgSegDur) && avgSegDur > 0 ? avgSegDur : 6
    const threshold = Math.ceil(60 / segDur) * 3
    const minute = Math.floor(Date.now() / 60000)
    const countKey = `${identifier}:${videoId}:${minute}`
    const count = (this.counts.get(countKey) ?? 0) + 1
    this.counts.set(countKey, count)
    setTimeout(() => this.counts.delete(countKey), 120_000).unref?.()
    return { count, threshold, exceeded: count > threshold }
  }
}

const limiter = new InMemorySegmentRateLimiter()

class InMemoryDurableObjectStub implements DurableObjectStub {
  constructor(private readonly id: DurableObjectIdStub) {}

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const req = input instanceof Request ? input : new Request(input, init)
    const body = (await req.json()) as SegmentRateLimitBody
    const result = await limiter.handle(body)
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

export class InMemoryDurableObjectNamespace implements DurableObjectNamespaceStub {
  idFromName(name: string): DurableObjectIdStub {
    return { toString: () => name }
  }

  get(id: DurableObjectIdStub): DurableObjectStub {
    return new InMemoryDurableObjectStub(id)
  }
}
