/// <reference lib="WebWorker" />
const sw = globalThis as unknown as ServiceWorkerGlobalScope & typeof globalThis

const PWA_AUTH_IDB = 'vmp-pwa-auth'
const PWA_AUTH_STORE = 'handoffs'

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

async function notifyClientsOrStore(handoffCode: string): Promise<void> {
  const clients = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true })
  if (clients.length > 0) {
    for (const client of clients) {
      client.postMessage({ type: 'pwa_auth_handoff', handoffCode })
    }
    await clients[0].focus()
    return
  }
  const db = await openIdb()
  await storeHandoffCode(db, handoffCode)
  await sw.clients.openWindow('/')
}

/**
 * Push handlers imported by the generated Workbox service worker.
 */
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
      data: { url: targetUrl },
    }),
  )
})

sw.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close()
  const notifData = event.notification?.data as { handoffCode?: string; url?: string } | undefined

  if (typeof notifData?.handoffCode === 'string') {
    const code = notifData.handoffCode
    event.waitUntil(
      sw.clients.openWindow(`/?pwa_auth_handoff=${encodeURIComponent(code)}`),
    )
    return
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
