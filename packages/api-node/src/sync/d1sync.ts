import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { NodeEnv, SyncResult } from '../types.js'
import type { SqliteD1Adapter } from '../bindings/db.js'

interface D1ExportStartResponse {
  success: boolean
  result?: {
    at_bookmark?: string
    status?: string
    signed_url?: string
    filename?: string
    error?: string
  }
  errors?: { message: string }[]
}

interface SyncState {
  lastBookmark: string | null
  lastSyncAt: string | null
  lastDurationMs: number | null
  lastRowCounts: Record<string, number> | null
}

let syncInProgress = false
let lastSyncState: SyncState = {
  lastBookmark: null,
  lastSyncAt: null,
  lastDurationMs: null,
  lastRowCounts: null,
}

export function getLastD1SyncState(): SyncState {
  return { ...lastSyncState }
}

function statePath(env: NodeEnv): string {
  return env.D1_SYNC_STATE_PATH ?? `${dirname(env.SQLITE_DB_PATH)}/d1-sync-state.json`
}

function loadSyncState(env: NodeEnv): SyncState {
  try {
    const raw = readFileSync(statePath(env), 'utf8')
    return { ...lastSyncState, ...JSON.parse(raw) as SyncState }
  } catch {
    return lastSyncState
  }
}

function saveSyncState(env: NodeEnv, state: SyncState): void {
  const path = statePath(env)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(state, null, 2))
  lastSyncState = state
}

async function cfApi<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const json = (await res.json()) as T & { errors?: { message: string }[] }
  if (!res.ok) {
    const msg = json.errors?.[0]?.message ?? res.statusText
    throw new Error(`Cloudflare API ${res.status}: ${msg}`)
  }
  return json
}

async function pollD1Export(
  accountId: string,
  databaseId: string,
  token: string,
  bookmark: string | null,
): Promise<{ signedUrl: string; atBookmark: string }> {
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/export`
  let currentBookmark = bookmark
  const maxAttempts = Math.max(
    1,
    Number.parseInt(process.env.D1_EXPORT_MAX_ATTEMPTS ?? '120', 10) || 120,
  )
  for (let i = 0; i < maxAttempts; i++) {
    const body: Record<string, string> = { output_format: 'polling' }
    if (currentBookmark) body.current_bookmark = currentBookmark

    const data = await cfApi<D1ExportStartResponse>(base, token, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    if (!data.success) {
      throw new Error(data.errors?.[0]?.message ?? 'D1 export failed')
    }
    const result = data.result
    if (!result) throw new Error('D1 export returned empty result')

    if (result.at_bookmark) currentBookmark = result.at_bookmark

    if (result.status === 'error') {
      throw new Error(result.error ?? 'D1 export error')
    }

    if (result.status === 'complete' && result.signed_url) {
      return { signedUrl: result.signed_url, atBookmark: currentBookmark ?? '' }
    }

    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error('D1 export timed out')
}

async function downloadExport(url: string, destPath: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to download D1 export: ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  mkdirSync(dirname(destPath), { recursive: true })
  writeFileSync(destPath, buf)
}

/**
 * STRATEGY A: full SQLite snapshot replace.
 *
 * TODO (Strategy B): incremental sync using CF export bookmarks and applying
 * only INSERT/UPDATE/DELETE deltas instead of replacing the whole file.
 */
export async function syncD1ToLocal(env: NodeEnv, db: SqliteD1Adapter): Promise<SyncResult> {
  const start = Date.now()
  if (syncInProgress) {
    return { ok: false, durationMs: 0, strategy: 'full-replace', error: 'sync already in progress' }
  }

  const accountId = env.CF_ACCOUNT_ID ?? process.env.CF_ACCOUNT_ID
  const databaseId = env.CF_D1_DATABASE_ID ?? process.env.CF_D1_DATABASE_ID
  const token = env.CF_API_TOKEN ?? process.env.CF_API_TOKEN

  if (!accountId || !databaseId || !token) {
    return {
      ok: false,
      durationMs: Date.now() - start,
      strategy: 'full-replace',
      error: 'CF_ACCOUNT_ID, CF_D1_DATABASE_ID, and CF_API_TOKEN required for D1 sync',
    }
  }

  syncInProgress = true
  try {
    const persisted = loadSyncState(env)
    const { signedUrl, atBookmark } = await pollD1Export(
      accountId,
      databaseId,
      token,
      persisted.lastBookmark,
    )

    const snapshotPath = `${dirname(env.SQLITE_DB_PATH)}/d1_snapshot.sqlite`
    await downloadExport(signedUrl, snapshotPath)

    const livePath = resolve(env.SQLITE_DB_PATH)
    const stagingPath = `${livePath}.staging`
    db.close()
    copyFileSync(snapshotPath, stagingPath)
    renameSync(stagingPath, livePath)
    db.reconnect(livePath)

    const rowCounts = db.countTableRows()
    const durationMs = Date.now() - start
    const state: SyncState = {
      lastBookmark: atBookmark,
      lastSyncAt: new Date().toISOString(),
      lastDurationMs: durationMs,
      lastRowCounts: rowCounts,
    }
    saveSyncState(env, state)

    console.log(`[d1sync] complete in ${durationMs}ms`, rowCounts)
    return { ok: true, durationMs, strategy: 'full-replace', bookmark: atBookmark, rowCounts }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[d1sync] failed:', message)
    try {
      db.reconnect(resolve(env.SQLITE_DB_PATH))
    } catch (reconnectErr) {
      console.error(
        '[d1sync] failed to reconnect database after sync error:',
        reconnectErr instanceof Error ? reconnectErr.message : reconnectErr,
      )
    }
    return {
      ok: false,
      durationMs: Date.now() - start,
      strategy: 'full-replace',
      error: message,
    }
  } finally {
    syncInProgress = false
  }
}
