"use strict";
const sw = globalThis;
const PWA_AUTH_IDB = 'vmp-pwa-auth';
const PWA_AUTH_STORE = 'handoffs';
function openIdb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(PWA_AUTH_IDB, 1);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(PWA_AUTH_STORE)) {
                db.createObjectStore(PWA_AUTH_STORE);
            }
        };
    });
}
async function storeHandoffCode(db, handoffCode) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(PWA_AUTH_STORE, 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.objectStore(PWA_AUTH_STORE).put(handoffCode, 'pending');
    });
}
async function notifyClientsOrStore(handoffCode) {
    const clients = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (clients.length > 0) {
        try {
            const db = await openIdb();
            await storeHandoffCode(db, handoffCode);
        }
        catch (err) {
            console.warn('[sw-push] IDB store failed:', err);
        }
        for (const client of clients) {
            client.postMessage({ type: 'pwa_auth_handoff', handoffCode });
        }
        const firstClient = clients[0];
        if (firstClient) {
            try {
                await firstClient.focus();
            }
            catch {
            }
        }
        return;
    }
    const db = await openIdb();
    await storeHandoffCode(db, handoffCode);
    await sw.clients.openWindow('/');
}
async function deliverHandoffToClients(handoffCode) {
    try {
        const db = await openIdb();
        await storeHandoffCode(db, handoffCode);
    }
    catch (err) {
        console.warn('[sw-push] IDB store failed:', err);
    }
    const clients = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (clients.length > 0) {
        for (const client of clients) {
            client.postMessage({ type: 'pwa_auth_handoff', handoffCode });
        }
        const firstClient = clients[0];
        if (firstClient) {
            try {
                await firstClient.focus();
            }
            catch {
            }
            if ('navigate' in firstClient && typeof firstClient.navigate === 'function') {
                try {
                    await firstClient.navigate(`/?pwa_auth_handoff=${encodeURIComponent(handoffCode)}`);
                    return;
                }
                catch {
                }
            }
        }
        return;
    }
    await sw.clients.openWindow(`/?pwa_auth_handoff=${encodeURIComponent(handoffCode)}`);
}
function stripTrailingSlashes(value) {
    let end = value.length;
    while (end > 0 && value[end - 1] === '/')
        end -= 1;
    return value.slice(0, end);
}
function isAllowedEventsUrl(raw) {
    if (typeof raw !== 'string' || !raw.trim())
        return undefined;
    try {
        const url = new URL(raw.trim());
        const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
        if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalhost))
            return undefined;
        const path = stripTrailingSlashes(url.pathname);
        if (path !== '/api/push/events')
            return undefined;
        return `${url.origin}/api/push/events`;
    }
    catch {
        return undefined;
    }
}
sw.addEventListener('push', (event) => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    }
    catch {
        data = {};
    }
    if (data.type === 'pwa_auth' && typeof data.handoffCode === 'string') {
        const handoffCode = data.handoffCode;
        const title = typeof data.title === 'string' ? data.title : 'Sign in';
        const body = typeof data.body === 'string' ? data.body : 'Tap to complete sign in';
        event.waitUntil((async () => {
            try {
                await notifyClientsOrStore(handoffCode);
            }
            catch (err) {
                console.warn('[sw-push] notifyClientsOrStore failed:', err);
            }
            await sw.registration.showNotification(title, {
                body,
                icon: '/icons/pwa-192.png',
                badge: '/icons/pwa-192.png',
                data: { handoffCode },
            });
        })());
        return;
    }
    const title = typeof data.title === 'string' && data.title.trim()
        ? data.title
        : 'New update';
    const body = typeof data.body === 'string' ? data.body : '';
    let targetUrl = '/';
    if (typeof data.url === 'string') {
        if (data.url.startsWith('/')) {
            targetUrl = data.url;
        }
        else {
            try {
                const url = new URL(data.url);
                if (url.origin === sw.location.origin) {
                    targetUrl = data.url;
                }
            }
            catch {
            }
        }
    }
    event.waitUntil(sw.registration.showNotification(title, {
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
    }));
});
sw.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const notifData = event.notification?.data;
    if (typeof notifData?.handoffCode === 'string') {
        const code = notifData.handoffCode;
        event.waitUntil(deliverHandoffToClients(code));
        return;
    }
    const deliveryId = typeof notifData?.deliveryId === 'string' ? notifData.deliveryId : '';
    const pushType = typeof notifData?.type === 'string' ? notifData.type : '';
    const eventsUrl = isAllowedEventsUrl(notifData?.eventsUrl);
    if (deliveryId && pushType === 'new_video' && eventsUrl) {
        event.waitUntil(fetch(eventsUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'click', deliveryId }),
        }).catch(() => undefined));
    }
    const targetUrl = notifData?.url || '/';
    event.waitUntil((async () => {
        let targetPath;
        let targetFullUrl = targetUrl;
        try {
            const parsed = new URL(targetUrl, sw.location.origin);
            targetPath = parsed.pathname;
            targetFullUrl = parsed.href;
        }
        catch {
            targetPath = targetUrl;
        }
        const clientList = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of clientList) {
            try {
                const currentUrl = new URL(client.url);
                if (currentUrl.pathname === targetPath) {
                    await client.focus();
                    return;
                }
            }
            catch {
            }
        }
        await sw.clients.openWindow(targetFullUrl);
    })());
});
