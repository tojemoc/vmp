"use strict";
const sw = globalThis;
const OFFLINE_MEDIA_URL_PREFIX = '/__vmp/offline-media/';
const OFFLINE_OPFS_ROOT = 'vmp-offline';
const IDB_BLOB_DB = 'vmp-offline-blobs';
const IDB_BLOB_STORE = 'chunks';
function contentTypeForPath(path) {
    if (path.endsWith('.m3u8'))
        return 'application/vnd.apple.mpegurl';
    if (path.endsWith('.m4s'))
        return 'video/iso.segment';
    if (path.endsWith('.mp4'))
        return 'video/mp4';
    if (path.endsWith('.vtt'))
        return 'text/vtt';
    return 'application/octet-stream';
}
function blobKey(videoId, relativePath) {
    return `${videoId}/${relativePath}`;
}
function openBlobIdb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_BLOB_DB, 1);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(IDB_BLOB_STORE)) {
                db.createObjectStore(IDB_BLOB_STORE);
            }
        };
    });
}
async function readFromIdb(videoId, relativePath) {
    try {
        const db = await openBlobIdb();
        const key = blobKey(videoId, relativePath);
        const meta = await new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_BLOB_STORE, 'readonly');
            tx.onerror = () => reject(tx.error);
            const req = tx.objectStore(IDB_BLOB_STORE).get(`${key}:meta`);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        if (!meta)
            return null;
        const parts = [];
        for (let i = 0; i < meta.chunkCount; i++) {
            const chunk = await new Promise((resolve, reject) => {
                const tx = db.transaction(IDB_BLOB_STORE, 'readonly');
                tx.onerror = () => reject(tx.error);
                const req = tx.objectStore(IDB_BLOB_STORE).get(`${key}:chunk:${i}`);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            if (!chunk)
                return null;
            parts.push(chunk);
        }
        const merged = new Uint8Array(meta.byteLength);
        let offset = 0;
        for (const part of parts) {
            merged.set(part, offset);
            offset += part.byteLength;
        }
        return merged;
    }
    catch {
        return null;
    }
}
async function readFromOpfs(videoId, relativePath) {
    if (typeof navigator.storage?.getDirectory !== 'function')
        return null;
    try {
        const root = await navigator.storage.getDirectory();
        const offlineRoot = await root.getDirectoryHandle(OFFLINE_OPFS_ROOT);
        const videoDir = await offlineRoot.getDirectoryHandle(videoId);
        const parts = relativePath.split('/').filter(Boolean);
        const fileName = parts.pop();
        if (!fileName)
            return null;
        let current = videoDir;
        for (const part of parts) {
            current = await current.getDirectoryHandle(part);
        }
        const handle = await current.getFileHandle(fileName);
        const file = await handle.getFile();
        return new Uint8Array(await file.arrayBuffer());
    }
    catch {
        return null;
    }
}
async function readOfflineAsset(videoId, relativePath) {
    const fromOpfs = await readFromOpfs(videoId, relativePath);
    if (fromOpfs)
        return fromOpfs;
    return readFromIdb(videoId, relativePath);
}
async function serveOfflineMedia(request) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(OFFLINE_MEDIA_URL_PREFIX)) {
        return new Response('Not found', { status: 404 });
    }
    const rest = url.pathname.slice(OFFLINE_MEDIA_URL_PREFIX.length);
    const slash = rest.indexOf('/');
    if (slash < 1)
        return new Response('Not found', { status: 404 });
    let videoId;
    let assetPath;
    try {
        videoId = decodeURIComponent(rest.slice(0, slash));
        assetPath = decodeURIComponent(rest.slice(slash + 1));
    }
    catch {
        return new Response('Invalid path', { status: 400 });
    }
    if (!videoId || !assetPath || assetPath.includes('..')) {
        return new Response('Invalid path', { status: 400 });
    }
    const bytes = await readOfflineAsset(videoId, assetPath);
    if (!bytes)
        return new Response('Not found', { status: 404 });
    const headers = new Headers({
        'Content-Type': contentTypeForPath(assetPath),
        'Cache-Control': 'private, no-store',
    });
    const body = new Uint8Array(bytes);
    return new Response(body, { status: 200, headers });
}
sw.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (!url.pathname.startsWith(OFFLINE_MEDIA_URL_PREFIX))
        return;
    event.respondWith(serveOfflineMedia(event.request));
});
