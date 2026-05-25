// Dynamic imports of @vmp/api are resolved at bundle/runtime; skip cross-package type resolution.
// @ts-nocheck
import type { CFEnvShape } from './types.js'

export type WorkerExecutionContext = {
  waitUntil: (promise: Promise<unknown>) => void
  passThroughOnException: () => void
}

export type WorkerFetch = (
  request: Request,
  env: CFEnvShape,
  ctx: WorkerExecutionContext,
) => Promise<Response>

let cachedFetch: WorkerFetch | null = null

export async function getWorkerFetch(): Promise<WorkerFetch> {
  if (cachedFetch) return cachedFetch
  const mod = (await import('../../api/src/index.js')) as unknown as { default: { fetch: WorkerFetch } }
  cachedFetch = mod.default.fetch.bind(mod.default) as WorkerFetch
  return cachedFetch
}

export async function requireAdminRole(
  request: Request,
  env: CFEnvShape,
  ...roles: string[]
): Promise<void> {
  const { requireRole } = (await import('../../api/src/auth.js')) as {
    requireRole: (req: Request, env: CFEnvShape, ...r: string[]) => Promise<void>
  }
  await requireRole(request, env, ...roles)
}
