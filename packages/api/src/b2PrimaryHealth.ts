/**
 * Durable Object tracking B2 primary availability for playback failover.
 * One global instance (idFromName('b2-primary-health')) — all isolates share state.
 */

export const B2_HEALTH_DO_NAME = 'b2-primary-health'
export const B2_FAILURE_THRESHOLD = 3
export const B2_HEALTH_COOLDOWN_MS = 60_000

interface HealthState {
  consecutiveFailures: number
  openedAt: number | null
}

type HealthAction = 'isHealthy' | 'recordSuccess' | 'recordFailure'

interface HealthRequestBody {
  action: HealthAction
}

export class B2PrimaryHealthDOBase {
  state: DurableObjectState

  constructor(state: DurableObjectState) {
    this.state = state
  }

  async fetch(request: Request): Promise<Response> {
    let body: HealthRequestBody
    try {
      body = await request.json() as HealthRequestBody
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const action = body.action
    if (action === 'isHealthy') {
      return jsonResponse({ healthy: await this.isHealthy() })
    }
    if (action === 'recordSuccess') {
      await this.recordSuccess()
      return jsonResponse({ ok: true })
    }
    if (action === 'recordFailure') {
      await this.recordFailure()
      return jsonResponse({ ok: true })
    }
    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  private async readState(): Promise<HealthState> {
    const stored = await this.state.storage.get<HealthState>('health')
    return stored ?? { consecutiveFailures: 0, openedAt: null }
  }

  private async writeState(next: HealthState): Promise<void> {
    await this.state.storage.put('health', next)
  }

  async isHealthy(): Promise<boolean> {
    const current = await this.readState()
    if (current.openedAt === null) return true
    if (Date.now() - current.openedAt > B2_HEALTH_COOLDOWN_MS) return true
    return false
  }

  async recordSuccess(): Promise<void> {
    await this.writeState({ consecutiveFailures: 0, openedAt: null })
  }

  async recordFailure(): Promise<void> {
    const current = await this.readState()
    const consecutiveFailures = current.consecutiveFailures + 1
    const openedAt = consecutiveFailures >= B2_FAILURE_THRESHOLD
      ? (current.openedAt ?? Date.now())
      : current.openedAt
    await this.writeState({ consecutiveFailures, openedAt })
  }
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export interface B2HealthBinding {
  idFromName(name: string): DurableObjectId
  get(id: DurableObjectId): DurableObjectStub
}

export function createDurableObjectHealthTracker(binding: B2HealthBinding) {
  const stub = binding.get(binding.idFromName(B2_HEALTH_DO_NAME))

  async function call<T>(action: HealthAction): Promise<T> {
    const response = await stub.fetch('https://b2-health.internal/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    if (!response.ok) {
      throw new Error(`B2 health DO returned ${response.status}`)
    }
    return await response.json() as T
  }

  return {
    async isHealthy(): Promise<boolean> {
      try {
        const result = await call<{ healthy: boolean }>('isHealthy')
        return result.healthy === true
      } catch (err) {
        console.error('[b2-health] isHealthy failed, assuming healthy:', err)
        return true
      }
    },
    async recordFailure(): Promise<void> {
      try {
        await call('recordFailure')
      } catch (err) {
        console.error('[b2-health] recordFailure failed:', err)
      }
    },
    async recordSuccess(): Promise<void> {
      try {
        await call('recordSuccess')
      } catch (err) {
        console.error('[b2-health] recordSuccess failed:', err)
      }
    },
  }
}
