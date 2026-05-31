/// <reference lib="WebWorker" />
const sw = globalThis as unknown as ServiceWorkerGlobalScope & typeof globalThis

const PWA_AUTH_IDB = 'vmp-pwa-auth'
const PWA_AUTH_STORE = 'handoffs'

/** Window clients that posted `pwa_auth_register_client` (installed PWA). */
const registeredPwaAuthClientIds = new Set<string>()

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PWA_AUTH_IDB, 1)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(PWA_AUTH_STORE)) {
        db.createObjectStore(PWA_AUTH_STORE)
      }
    }
  })
}

async function storeHandoffCode(db: IDBDatabase, handoffCode: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PWA_AUTH_STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.objectStore(PWA_AUTH_STORE).put(handoffCode, 'pending')
  })
}

function isSameOriginNonAuthClient(client: Client): boolean {
  try {
    const url = new URL(client.url)
    if (url.origin !== sw.location.origin) return false
    if (url.pathname.startsWith('/auth/')) return false
    return true
  } catch {
    return false
  }
}

function isRegisteredPwaAuthClient(client: Client): boolean {
  return isSameOriginNonAuthClient(client) && registeredPwaAuthClientIds.has(client.id)
}

function pickAppShellClient(clients: readonly Client[]): WindowClient | undefined {
  const validated = clients.filter(isRegisteredPwaAuthClient) as WindowClient[]
  if (validated.length === 0) return undefined
  return validated.find((c) => c.focused) ?? validated[0]
}

sw.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data = event.data as { type?: string } | null
  if (data?.type !== 'pwa_auth_register_client') return
  const source = event.source
  if (source && 'id' in source && typeof source.id === 'string') {
    registeredPwaAuthClientIds.add(source.id)
  }
})

async function persistHandoffAndOpen(handoffCode: string): Promise<void> {
  const db = await openIdb()
  await storeHandoffCode(db, handoffCode)
  await sw.clients.openWindow(`/?pwa_auth_handoff=${encodeURIComponent(handoffCode)}`)
}

async function deliverHandoffToSingleClient(handoffCode: string): Promise<void> {
  try {
    const db = await openIdb()
    await storeHandoffCode(db, handoffCode)
  } catch (err) {
    console.warn('[sw-push] IDB store failed:', err)
  }

  const clients = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const target = pickAppShellClient(clients)
  if (!target) {
    await persistHandoffAndOpen(handoffCode)
    return
  }

  target.postMessage({ type: 'pwa_auth_handoff', handoffCode })
  try {
    await target.focus()
  } catch {
    // focus may fail on some platforms
  }
  if ('navigate' in target && typeof target.navigate === 'function') {
    try {
      await target.navigate(`/?pwa_auth_handoff=${encodeURIComponent(handoffCode)}`)
    } catch {
      // navigate not supported — postMessage + IDB are enough
    }
  }
}

async function notifyClientsOrStore(handoffCode: string): Promise<void> {
  const clients = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const target = pickAppShellClient(clients)
  if (target) {
    try {
      const db = await openIdb()
      await storeHandoffCode(db, handoffCode)
    } catch (err) {
      console.warn('[sw-push] IDB store failed:', err)
    }
    target.postMessage({ type: 'pwa_auth_handoff', handoffCode })
    try {
      await target.focus()
    } catch {
      // focus may fail on some platforms
    }
    return
  }
  await persistHandoffAndOpen(handoffCode)
}

async function deliverHandoffToClients(handoffCode: string): Promise<void> {
  await deliverHandoffToSingleClient(handoffCode)
}

/**
 * Push handlers imported by the generated Workbox service worker.
 */

function stripTrailingSlashes(value: string) {
  let end = value.length
  while (end > 0 && value[end - 1] === '/') end -= 1
  return value.slice(0, end)
}

function isAllowedEventsUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined
  try {
    const url = new URL(raw.trim())
    const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalhost)) return undefined
    const path = stripTrailingSlashes(url.pathname)
    if (path !== '/api/push/events') return undefined
    return `${url.origin}/api/push/events`
  } catch {
    return undefined
  }
}

sw.addEventListener('push', (event: PushEvent) => {
  let data: Record<string, unknown> = {}
  try {
    data = event.data ? (event.data.json() as Record<string, unknown>) : {}
  } catch {
    data = {}
  }

  if (data.type === 'pwa_auth' && typeof data.handoffCode === 'string') {
    const handoffCode = data.handoffCode
    const title = typeof data.title === 'string' ? data.title : 'Sign in'
    const body = typeof data.body === 'string' ? data.body : 'Tap to complete sign in'
    event.waitUntil(
      (async () => {
        try {
          await notifyClientsOrStore(handoffCode)
        } catch (err) {
          console.warn('[sw-push] notifyClientsOrStore failed:', err)
        }
        await sw.registration.showNotification(title, {
          body,
          icon: '/icons/pwa-192.png',
          badge: '/icons/pwa-192.png',
          data: { handoffCode },
        })
      })(),
    )
    return
  }

  const title = typeof data.title === 'string' && data.title.trim()
    ? data.title
    : 'New update'
  const body = typeof data.body === 'string' ? data.body : ''

  let targetUrl = '/'
  if (typeof data.url === 'string') {
    if (data.url.startsWith('/')) {
      targetUrl = data.url
    } else {
      try {
        const url = new URL(data.url)
        if (url.origin === sw.location.origin) {
          targetUrl = data.url
        }
      } catch {
        // Invalid URL, fallback to '/'
      }
    }
  }

  event.waitUntil(
    sw.registration.showNotification(title, {
      body,
      icon: '/icons/pwa-192.png',
      badge: '/icons/pwa-192.png',
      data: {
        url: targetUrl,
        type: typeof data.type === 'string' ? data.type : 'new_video',
        deliveryId: typeof data.deliveryId === 'string' ? data.deliveryId : undefined,
        campaignId: typeof data.campaignId === 'string' ? data.campaignId : undefined,
        eventsUrl: isAllowedEventsUrl(data.eventsUrl),
      },
    }),
  )
})

sw.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close()
  const notifData = event.notification?.data as {
    handoffCode?: string
    url?: string
    deliveryId?: string
    type?: string
    eventsUrl?: string
  } | undefined

  if (typeof notifData?.handoffCode === 'string') {
    const code = notifData.handoffCode
    event.waitUntil(deliverHandoffToClients(code))
    return
  }

  const deliveryId = typeof notifData?.deliveryId === 'string' ? notifData.deliveryId : ''
  const pushType = typeof notifData?.type === 'string' ? notifData.type : ''
  const eventsUrl = isAllowedEventsUrl(notifData?.eventsUrl)
  if (deliveryId && pushType === 'new_video' && eventsUrl) {
    event.waitUntil(
      fetch(eventsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'click', deliveryId }),
      }).catch(() => undefined),
    )
  }

  const targetUrl = notifData?.url || '/'

  event.waitUntil((async () => {
    let targetPath: string
    let targetFullUrl = targetUrl
    try {
      const parsed = new URL(targetUrl, sw.location.origin)
      targetPath = parsed.pathname
      targetFullUrl = parsed.href
    } catch {
      targetPath = targetUrl
    }

    const clientList = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of clientList) {
      try {
        const currentUrl = new URL(client.url)
        if (currentUrl.pathname === targetPath) {
          await client.focus()
          return
        }
      } catch {
        // ignore malformed URLs
      }
    }

    await sw.clients.openWindow(targetFullUrl)
  })())
})
