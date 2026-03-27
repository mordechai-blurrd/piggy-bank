/* ════════════════════════════════════════════════════════════
   🐷 Daily Piggy Bank — Service Worker
   - Caches app shell for offline use
   - Handles notification clicks
   ════════════════════════════════════════════════════════════ */

const CACHE_NAME  = 'piggybank-v1';
const APP_SHELL   = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg'
];

/* ── Install: cache app shell ──────────────────────────────────────────────── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

/* ── Activate: clear old caches ────────────────────────────────────────────── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

/* ── Fetch: serve from cache, fall back to network ─────────────────────────── */
self.addEventListener('fetch', event => {
  // Only handle GET requests for same-origin resources
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request).then(response => {
        // Cache successful responses for app files
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback — serve index.html for navigation requests
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});

/* ── Notification click: open / focus the app ──────────────────────────────── */
self.addEventListener('notificationclick', event => {
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      // If app is already open, focus it
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      // Otherwise open a new window
      return self.clients.openWindow('./index.html?action=checkin');
    })
  );
});

/* ── Push (future-ready hook) ──────────────────────────────────────────────── */
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || '🐷 Daily Piggy Bank';
  const body  = data.body  || "Don't forget to log today's task!";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon:      './icon.svg',
      badge:     './icon.svg',
      tag:       'daily-checkin',
      renotify:  true,
      vibrate:   [200, 100, 200],
      actions: [
        { action: 'done',  title: '✅ Done!' },
        { action: 'later', title: '⏰ Remind me later' }
      ]
    })
  );
});
