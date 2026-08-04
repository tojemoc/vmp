/**
 * Push encore-packager queue messages (Eyevinn format: sorted set + bzPopMin).
 */

import { createClient } from 'redis'

const REDIS_URL = (process.env.REDIS_URL || 'redis://127.0.0.1:6379').trim()
const REDIS_QUEUE = (process.env.REDIS_QUEUE || 'packaging-queue').trim()

/** Concrete client type from default createClient() (RESP3 in redis@6). */
type PackagingRedisClient = ReturnType<typeof createPackagingClient>

function createPackagingClient() {
  return createClient({ url: REDIS_URL })
}

let client: PackagingRedisClient | null = null
let connectPromise: Promise<PackagingRedisClient> | null = null

async function getRedis(): Promise<PackagingRedisClient> {
  if (client?.isOpen) return client
  if (connectPromise) return connectPromise

  connectPromise = (async () => {
    const newClient = createPackagingClient()
    newClient.on('error', (err) => {
      process.stderr.write(`[packaging-queue] redis error: ${err instanceof Error ? err.message : String(err)}\n`)
    })
    await newClient.connect()
    client = newClient
    return newClient
  })()

  try {
    return await connectPromise
  } finally {
    connectPromise = null
  }
}

export async function enqueuePackagerJob(jobId: string, encoreJobUrl: string): Promise<void> {
  const redis = await getRedis()
  const message = JSON.stringify({ jobId, url: encoreJobUrl })
  await redis.zAdd(REDIS_QUEUE, { score: Date.now(), value: message })
}

export async function closePackagingRedis(): Promise<void> {
  if (client?.isOpen) await client.quit()
  client = null
}
