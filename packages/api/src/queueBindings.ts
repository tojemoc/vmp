/**
 * Cloudflare Queue env bindings.
 *
 * In wrangler.json, `binding` is the property on `env` in Worker code.
 * `queue` is only the Cloudflare queue resource name (e.g. vmp-replication-events).
 *
 * Keep these names aligned with packages/api/wrangler.json producers.
 */
export function getReplicationQueue(env: {
  vmp_replication_events?: {
    sendBatch: (messages: Iterable<{ body: unknown }>) => Promise<unknown>
  }
}) {
  return env.vmp_replication_events
}

export function getPushDeliveryQueue(env: {
  vmp_push_delivery?: {
    send: (body: unknown, options?: { delaySeconds?: number }) => Promise<unknown>
  }
}) {
  return env.vmp_push_delivery
}
