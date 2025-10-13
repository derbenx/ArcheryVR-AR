const APP_PREFIX = 'archAR-cache-';
const PRECACHE_ASSETS = [
    './',
    'index.html',
    'main.js',
    'manifest.json',
    'version.json',
    '3d/archery.glb',
    'js/three/build/three.module.js',
    'js/rapier/rapier.mjs',
    'js/rapier/rapier_wasm3d.js',
    'js/rapier/rapier_wasm3d_bg.wasm',
    'js/three/addons/webxr/ARButton.js',
    'js/three/addons/loaders/GLTFLoader.js',
    'js/three/addons/webxr/XRControllerModelFactory.js',
    'js/three/addons/webxr/XRPlanes.js'
];

self.addEventListener('install', async (event) => {
    console.log('[SW] Install event');
    try {
        const versionResponse = await fetch('./version.json', { cache: 'no-store' });
        if (!versionResponse.ok) {
            throw new Error('Failed to fetch version.json');
        }
        const versionData = await versionResponse.json();
        const CACHE_NAME = `${APP_PREFIX}v${versionData.version}`;
        self.CACHE_NAME = CACHE_NAME; // Store for use in other events

        event.waitUntil(
            (async () => {
                console.log(`[SW] Caching app shell for version: ${versionData.version}`);
                const cache = await caches.open(CACHE_NAME);
                // The all-or-nothing nature of addAll ensures a clean install.
                // If any asset fails to fetch, the entire installation is aborted.
                await cache.addAll(PRECACHE_ASSETS);
                // Force the waiting service worker to become the active service worker.
                return self.skipWaiting();
            })()
        );
    } catch (error) {
        console.error('[SW] Installation failed:', error);
        // Do not call self.skipWaiting(), so the installation fails and the old worker remains active.
    }
});

self.addEventListener('activate', (event) => {
    console.log('[SW] Activate event');
    event.waitUntil(
        (async () => {
            // Enable navigation preload if it's supported.
            // This allows the browser to start fetching navigation requests while the service worker is starting up.
            if ('navigationPreload' in self.registration) {
                await self.registration.navigationPreload.enable();
            }

            // Clean up old caches.
            const cacheNames = await caches.keys();
            await Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName.startsWith(APP_PREFIX) && cacheName !== self.CACHE_NAME) {
                        console.log(`[SW] Deleting old cache: ${cacheName}`);
                        return caches.delete(cacheName);
                    }
                })
            );
            // Take control of all open clients (tabs) immediately.
            return self.clients.claim();
        })()
    );
});

self.addEventListener('fetch', (event) => {
    // For non-GET requests, we don't need to do anything.
    if (event.request.method !== 'GET') {
        return;
    }

    event.respondWith(
        (async () => {
            const cache = await caches.open(self.CACHE_NAME);
            const cachedResponse = await cache.match(event.request);

            // Return the cached response if it exists.
            if (cachedResponse) {
                // console.log(`[SW] Serving from cache: ${event.request.url}`);
                return cachedResponse;
            }

            // For navigation requests, try to fall back to the root page if the specific page isn't cached.
            // This is useful for single-page applications.
            if (event.request.mode === 'navigate') {
                const rootCache = await cache.match('./');
                if (rootCache) {
                    return rootCache;
                }
            }

            // If the resource is not in the cache, fetch it from the network.
            // This path is taken for assets not in PRECACHE_ASSETS or for the very first visit.
            try {
                // console.log(`[SW] Fetching from network: ${event.request.url}`);
                const networkResponse = await fetch(event.request);
                return networkResponse;
            } catch (error) {
                console.error(`[SW] Fetch failed for: ${event.request.url}`, error);
                // Optionally, you could return a custom offline fallback page here.
                // For example: return caches.match('/offline.html');
                throw error;
            }
        })()
    );
});