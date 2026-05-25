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

export async function readStoredPwaHandoffCode(): Promise<string | null> {
  if (import.meta.server) return null
  try {
    const db = await openIdb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(PWA_AUTH_STORE, 'readonly')
      tx.onerror = () => reject(tx.error)
      const req = tx.objectStore(PWA_AUTH_STORE).get('pending')
      req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : null)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

export async function clearStoredPwaHandoffCode(): Promise<void> {
  if (import.meta.server) return
  try {
    const db = await openIdb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(PWA_AUTH_STORE, 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.objectStore(PWA_AUTH_STORE).delete('pending')
    })
  } catch {
    // best effort
  }
}
