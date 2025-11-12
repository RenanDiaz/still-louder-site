// Still Louder - Al Vacío - Service Worker
// Version 1.0.0 - PWA Implementation

const CACHE_VERSION = 'still-louder-v1.0.0';
const OFFLINE_VERSION = 'still-louder-offline-v1.0.0';

// Cache names
const PRECACHE_NAME = `${CACHE_VERSION}-precache`;
const RUNTIME_CACHE_NAME = `${CACHE_VERSION}-runtime`;
const IMAGE_CACHE_NAME = `${CACHE_VERSION}-images`;
const OFFLINE_CACHE_NAME = OFFLINE_VERSION;

// Assets to precache (critical resources)
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/al-vacio-pre-release.html',
  '/offline.html',
  '/assets/css/style.css',
  '/assets/js/script.js',
  '/assets/js/sw-register.js',
  '/assets/site.webmanifest',
  '/assets/favicon-96x96.png',
  '/assets/favicon.svg',
  '/assets/apple-touch-icon.png',
  '/assets/web-app-manifest-192x192.png',
  '/assets/web-app-manifest-512x512.png',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap'
];

// Install event - precache critical assets
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing Service Worker...', event);

  event.waitUntil(
    caches.open(PRECACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Precaching critical assets');
        return cache.addAll(PRECACHE_URLS.map(url => new Request(url, { cache: 'no-cache' })));
      })
      .then(() => {
        // Cache offline page separately to ensure it's always available
        return caches.open(OFFLINE_CACHE_NAME)
          .then((cache) => cache.add(new Request('/offline.html', { cache: 'no-cache' })));
      })
      .then(() => self.skipWaiting()) // Force waiting service worker to become active
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating Service Worker...', event);

  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            // Delete old caches that don't match current version
            if (cacheName !== PRECACHE_NAME &&
                cacheName !== RUNTIME_CACHE_NAME &&
                cacheName !== IMAGE_CACHE_NAME &&
                cacheName !== OFFLINE_CACHE_NAME) {
              console.log('[Service Worker] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => self.clients.claim()) // Take control of all pages immediately
  );
});

// Fetch event - implement caching strategies
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip Chrome extensions and cross-origin requests we don't want to cache
  if (url.protocol === 'chrome-extension:' || url.protocol === 'moz-extension:') {
    return;
  }

  // Handle Google Analytics separately (network-only)
  if (url.hostname === 'www.google-analytics.com' ||
      url.hostname === 'www.googletagmanager.com' ||
      url.pathname.includes('/gtag/')) {
    event.respondWith(fetch(request).catch(() => new Response()));
    return;
  }

  // Strategy: Cache First for images (external and local)
  if (request.destination === 'image' || url.pathname.match(/\.(jpg|jpeg|png|gif|svg|webp|avif|ico)$/)) {
    event.respondWith(cacheFirstStrategy(request, IMAGE_CACHE_NAME));
    return;
  }

  // Strategy: Cache First for fonts
  if (request.destination === 'font' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirstStrategy(request, RUNTIME_CACHE_NAME));
    return;
  }

  // Strategy: Stale While Revalidate for CSS and JS
  if (request.destination === 'style' || request.destination === 'script') {
    event.respondWith(staleWhileRevalidateStrategy(request, RUNTIME_CACHE_NAME));
    return;
  }

  // Strategy: Network First for HTML pages (with offline fallback)
  if (request.destination === 'document' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirstStrategy(request));
    return;
  }

  // Strategy: Network First for audio (don't cache large audio files)
  if (request.destination === 'audio' || url.pathname.includes('.mp3')) {
    event.respondWith(
      fetch(request).catch(() => {
        return new Response('Audio not available offline', {
          status: 503,
          statusText: 'Service Unavailable'
        });
      })
    );
    return;
  }

  // Default: Network First with cache fallback
  event.respondWith(networkFirstStrategy(request));
});

// Caching Strategies

/**
 * Cache First Strategy: Check cache first, fallback to network
 * Best for: Images, fonts, static assets that don't change often
 */
async function cacheFirstStrategy(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  if (cached) {
    console.log('[Service Worker] Cache hit:', request.url);
    return cached;
  }

  try {
    const response = await fetch(request);

    // Only cache successful responses
    if (response.ok) {
      // Clone response before caching
      cache.put(request, response.clone());
      console.log('[Service Worker] Cached new resource:', request.url);
    }

    return response;
  } catch (error) {
    console.error('[Service Worker] Fetch failed:', error);

    // Return a fallback response for images
    if (request.destination === 'image') {
      return new Response(
        '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#000"/><text x="50%" y="50%" text-anchor="middle" fill="#fff" dy=".3em">Offline</text></svg>',
        { headers: { 'Content-Type': 'image/svg+xml' } }
      );
    }

    throw error;
  }
}

/**
 * Network First Strategy: Try network first, fallback to cache
 * Best for: HTML pages, API calls, dynamic content
 */
async function networkFirstStrategy(request) {
  try {
    const response = await fetch(request);

    // Clone and cache successful responses
    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE_NAME);
      cache.put(request, response.clone());
    }

    return response;
  } catch (error) {
    console.log('[Service Worker] Network failed, checking cache:', request.url);

    // Try cache
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }

    // If it's a navigation request, return offline page
    if (request.mode === 'navigate' || request.destination === 'document') {
      const offlineCache = await caches.open(OFFLINE_CACHE_NAME);
      const offlinePage = await offlineCache.match('/offline.html');

      if (offlinePage) {
        return offlinePage;
      }
    }

    // No cache available, return error
    return new Response('Network error and no cache available', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

/**
 * Stale While Revalidate Strategy: Return cache immediately, update in background
 * Best for: CSS, JS that should be fast but stay fresh
 */
async function staleWhileRevalidateStrategy(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  // Fetch in background and update cache
  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch((error) => {
    console.error('[Service Worker] Background fetch failed:', error);
    return cached; // Return cached if fetch fails
  });

  // Return cached immediately if available, otherwise wait for fetch
  return cached || fetchPromise;
}

// Message event - handle messages from clients
self.addEventListener('message', (event) => {
  console.log('[Service Worker] Message received:', event.data);

  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => caches.delete(cacheName))
        );
      })
    );
  }

  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_VERSION });
  }
});

// Background Sync (for future implementation)
self.addEventListener('sync', (event) => {
  console.log('[Service Worker] Background sync:', event.tag);

  if (event.tag === 'sync-analytics') {
    event.waitUntil(syncAnalytics());
  }
});

async function syncAnalytics() {
  // Placeholder for syncing offline analytics when connection returns
  console.log('[Service Worker] Syncing analytics...');
  // Implementation would go here
}

// Push notifications (for future implementation)
self.addEventListener('push', (event) => {
  console.log('[Service Worker] Push received:', event);

  const options = {
    body: event.data ? event.data.text() : 'New content available!',
    icon: '/assets/web-app-manifest-192x192.png',
    badge: '/assets/favicon-96x96.png',
    vibrate: [200, 100, 200],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    },
    actions: [
      {
        action: 'explore',
        title: 'View',
        icon: '/assets/favicon-96x96.png'
      },
      {
        action: 'close',
        title: 'Close',
        icon: '/assets/favicon-96x96.png'
      }
    ]
  };

  event.waitUntil(
    self.registration.showNotification('Still Louder', options)
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  console.log('[Service Worker] Notification click:', event.action);

  event.notification.close();

  if (event.action === 'explore') {
    event.waitUntil(
      clients.openWindow('/')
    );
  }
});

console.log('[Service Worker] Service Worker loaded successfully!');
