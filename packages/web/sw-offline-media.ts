/// <reference lib="WebWorker" />
const sw = globalThis as unknown as ServiceWorkerGlobalScope & typeof globalThis

const OFFLINE_MEDIA_URL_PREFIX = '/__vmp/offline-media/'
const OFFLINE_OPFS_ROOT = 'vmp-offline'

function contentTypeForPath(path: string): string {
  if (path.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl'
  if (path.endsWith('.m4s')) return 'video/iso.segment'
  if (path.endsWith('.mp4')) return 'video/mp4'
  if (path.endsWith('.vtt')) return 'text/vtt'
  return 'application/octet-stream'
}

async function readFromOpfs(videoId: string, relativePath: string): Promise<Uint8Array | null> {
  if (typeof navigator.storage?.getDirectory !== 'function') return null
  try {
    const root = await navigator.storage.getDirectory()
    const offlineRoot = await root.getDirectoryHandle(OFFLINE_OPFS_ROOT)
    const videoDir = await offlineRoot.getDirectoryHandle(videoId)
    const parts = relativePath.split('/').filter(Boolean)
    const fileName = parts.pop()
    if (!fileName) return null
    let current: FileSystemDirectoryHandle = videoDir
    for (const part of parts) {
      current = await current.getDirectoryHandle(part)
    }
    const handle = await current.getFileHandle(fileName)
    const file = await handle.getFile()
    return new Uint8Array(await file.arrayBuffer())
  } catch {
    return null
  }
}

async function serveOfflineMedia(request: Request): Promise<Response> {
  const url = new URL(request.url)
  if (!url.pathname.startsWith(OFFLINE_MEDIA_URL_PREFIX)) {
    return new Response('Not found', { status: 404 })
  }

  const rest = url.pathname.slice(OFFLINE_MEDIA_URL_PREFIX.length)
  const slash = rest.indexOf('/')
  if (slash < 1) return new Response('Not found', { status: 404 })

  const videoId = decodeURIComponent(rest.slice(0, slash))
  const assetPath = decodeURIComponent(rest.slice(slash + 1))
  if (!videoId || !assetPath || assetPath.includes('..')) {
    return new Response('Invalid path', { status: 400 })
  }

  const bytes = await readFromOpfs(videoId, assetPath)
  if (!bytes) return new Response('Not found', { status: 404 })

  const headers = new Headers({
    'Content-Type': contentTypeForPath(assetPath),
    'Cache-Control': 'private, no-store',
  })
  const body = new Uint8Array(bytes)
  return new Response(body, { status: 200, headers })
}

sw.addEventListener('fetch', (event: FetchEvent) => {
  const url = new URL(event.request.url)
  if (!url.pathname.startsWith(OFFLINE_MEDIA_URL_PREFIX)) return
  event.respondWith(serveOfflineMedia(event.request))
})
