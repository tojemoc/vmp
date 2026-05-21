import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { installCachePolyfill } from './bindings/cache.js'
import { buildCorsHeaders } from './middleware/cors.js'
import { buildHealthResponse } from './middleware/health.js'
import { buildEnv, getDbAdapter, getEnv, rebuildEnv, toNodeEnv } from './env.js'
import { syncD1ToLocal } from './sync/d1sync.js'
import type { CFEnvShape } from './types.js'
import workerHandler from '../../api/src/index.js'
import { requireRole } from '../../api/src/auth.js'
installCachePolyfill()

const PORT = Number.parseInt(process.env.PORT ?? '8787', 10)
const SYNC_INTERVAL_MS = Number.parseInt(process.env.D1_SYNC_INTERVAL_MS ?? '300000', 10)

async function readBody(req: IncomingMessage): Promise<Buffer | null> {
  if (req.method === 'GET' || req.method === 'HEAD') return null
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function nodeRequestToWeb(req: IncomingMessage, body: Buffer | null): Request {
  const host = req.headers.host ?? `localhost:${PORT}`
  const url = `http://${host}${req.url ?? '/'}`
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v)
    } else {
      headers.set(key, value)
    }
  }
  const init: RequestInit = { method: req.method, headers }
  if (body && body.length > 0) {
    init.body = new Uint8Array(body)
  }
  return new Request(url, init)
}

async function writeWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'transfer-encoding') return
    res.setHeader(key, value)
  })
  if (response.body) {
    const nodeStream = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream)
    for await (const chunk of nodeStream) {
      res.write(chunk)
    }
  }
  res.end()
}

async function handleFailoverAdminRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  env: CFEnvShape,
): Promise<boolean> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const corsHeaders = buildCorsHeaders(new Request(url), env)

  if (url.pathname === '/api/admin/failover/write-log' && req.method === 'GET') {
    try {
      const request = nodeRequestToWeb(req, null)
      await requireRole(request, env, 'admin', 'super_admin')
      const db = getDbAdapter()
      if (!db) {
        res.writeHead(503, { 'Content-Type': 'application/json', ...corsHeaders })
        res.end(JSON.stringify({ error: 'Database not available' }))
        return true
      }
      const limit = Math.min(1000, Number.parseInt(url.searchParams.get('limit') ?? '100', 10) || 100)
      const entries = db.listWriteLog(limit)
      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders })
      res.end(JSON.stringify({ entries, count: db.getWriteLogPendingCount() }))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unauthorized'
      const status = message.includes('Forbidden') ? 403 : 401
      res.writeHead(status, { 'Content-Type': 'application/json', ...corsHeaders })
      res.end(JSON.stringify({ error: message }))
    }
    return true
  }

  if (url.pathname === '/api/admin/failover/write-log/export' && req.method === 'POST') {
    try {
      const request = nodeRequestToWeb(req, await readBody(req))
      await requireRole(request, env, 'admin', 'super_admin')
      const db = getDbAdapter()
      if (!db) {
        res.writeHead(503, { 'Content-Type': 'application/json', ...corsHeaders })
        res.end(JSON.stringify({ error: 'Database not available' }))
        return true
      }
      const sql = db.exportWriteLogSql()
      res.writeHead(200, {
        'Content-Type': 'application/sql',
        'Content-Disposition': `attachment; filename="failover-write-log-${Date.now()}.sql"`,
        ...corsHeaders,
      })
      res.end(sql)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unauthorized'
      const status = message.includes('Forbidden') ? 403 : 401
      res.writeHead(status, { 'Content-Type': 'application/json', ...corsHeaders })
      res.end(JSON.stringify({ error: message }))
    }
    return true
  }

  return false
}

async function handleRequest(req: IncomingMessage, res: ServerResponse, env: CFEnvShape): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

  if (url.pathname === '/api/health' && req.method === 'GET') {
    const { statusCode, body } = await buildHealthResponse(env)
    const corsHeaders = buildCorsHeaders(new Request(url), env)
    res.writeHead(statusCode, { 'Content-Type': 'application/json', ...corsHeaders })
    res.end(JSON.stringify(body))
    return
  }

  if (await handleFailoverAdminRoutes(req, res, env)) return

  const body = await readBody(req)
  const request = nodeRequestToWeb(req, body)
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => {
      promise.catch((err) => console.error('[waitUntil]', err))
    },
    passThroughOnException: () => {},
  }

  const response = await workerHandler.fetch(request, env, ctx)
  await writeWebResponse(res, response)
}

async function runD1Sync(): Promise<void> {
  const db = getDbAdapter()
  if (!db) return
  const env = toNodeEnv(await getEnv())
  await syncD1ToLocal(env, db)
}

async function main(): Promise<void> {
  await buildEnv()

  await runD1Sync()
  setInterval(() => {
    runD1Sync().catch((err) => console.error('[d1sync] interval error:', err))
  }, SYNC_INTERVAL_MS).unref?.()

  const server = http.createServer(async (req, res) => {
    try {
      const env = await getEnv()
      await handleRequest(req, res, env)
    } catch (err) {
      console.error('Unhandled error:', err)
      if (!res.headersSent) {
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'Internal server error' }))
      }
    }
  })

  server.listen(PORT, () => {
    console.log(`[failover] listening on :${PORT}`)
  })

  process.on('SIGHUP', () => {
    rebuildEnv().catch((err) => console.error('[failover] SIGHUP rebuild failed:', err))
  })
}

main().catch((err) => {
  console.error('[failover] fatal:', err)
  process.exit(1)
})
