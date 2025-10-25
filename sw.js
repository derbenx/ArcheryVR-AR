const DEV_HOST = 'dbfm.derben.ca';
const PROD_HOST = 'derben.ca';
const CACHE_PREFIX = 'archery-cache-';

let currentCacheName;

const ASSETS = [
    '/',
    '/game.html',
    '/main.js',
    '/manifest.json',
    '/js/rapier/rapier.mjs',
    '/js/rapier/rapier_wasm3d.js',
    '/js/rapier/rapier_wasm3d_bg.wasm',
    '/js/three/build/three.module.js',
    '/js/three/examples/jsm/webxr/ARButton.js',
    '/js/three/examples/jsm/loaders/GLTFLoader.js',
    '/js/three/examples/jsm/webxr/XRControllerModelFactory.js',
    '/js/three/examples/jsm/webxr/XRPlanes.js',
    '/3d/archery.glb'
];

// Helper function to send progress messages
const sendMessage = async (message) => {
    const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    clients.forEach(client => {
        client.postMessage(message);
    });
};

self.addEventListener('install', (event) => {
    event.waitUntil(
        (async () => {
            try {
                const response = await fetch('/version.json');
                const { version } = await response.json();
                const cacheName = `${CACHE_PREFIX}v${version}`;
                const cache = await caches.open(cacheName);
                const total = ASSETS.length;

                for (let i = 0; i < total; i++) {
                    const asset = ASSETS[i];
                    try {
                        const cachedResponse = await cache.match(asset);
                        if (!cachedResponse) {
                            await cache.add(asset);
                        }
                        await sendMessage({ type: 'progress', loaded: i + 1, total: total, file: asset });
                    } catch (err) {
                        console.error(`Failed to cache ${asset}:`, err);
                        await sendMessage({ type: 'error', message: `Failed to download: ${asset}` });
                        throw err;
                    }
                }
                await sendMessage({ type: 'complete' });
            } catch (err) {
                console.error('Service worker installation failed.', err);
            }
        })()
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            const response = await fetch('/version.json');
            const { version } = await response.json();
            currentCacheName = `${CACHE_PREFIX}v${version}`;

            const cacheNames = await caches.keys();
            const oldCacheNames = cacheNames.filter(name => {
                return name.startsWith(CACHE_PREFIX) && name !== currentCacheName;
            });

            await Promise.all(oldCacheNames.map(name => caches.delete(name)));
        })()
    );
});

self.addEventListener('fetch', (event) => {
    const requestUrl = new URL(event.request.url);

    if (requestUrl.hostname === DEV_HOST) {
        event.respondWith(fetch(event.request));
        return;
    }

    event.respondWith(
        (async () => {
            const cachedResponse = await caches.match(event.request);
            if (cachedResponse) {
                return cachedResponse;
            }

            try {
                const networkResponse = await fetch(event.request);

                if (currentCacheName && event.request.method === 'GET') {
                    const cache = await caches.open(currentCacheName);
                    cache.put(event.request, networkResponse.clone());
                }

                return networkResponse;
            } catch (error) {
                console.error('Fetch failed:', error);
            }
        })()
    );
});
