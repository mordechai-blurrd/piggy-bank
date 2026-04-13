/* ════════════════════════════════════════════════════════════
   🐷 Daily Piggy Bank — Service Worker v2
   - Caches app shell for offline use
   - Periodic Background Sync: daily reminders fire even
     when the app is fully closed on Android Chrome
   ════════════════════════════════════════════════════════════ */

const CACHE_NAME  = 'piggybank-v3';
const SETTINGS_KEY = 'piggybank-settings-v1';
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
      Promise.all(
        keys.filter(k => k !== CACHE_NAME && k !== SETTINGS_KEY)
            .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

/* ── Fetch: serve from cache, fall back to network ─────────────────────────── */
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request).then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});

/* ══════════════════════════════════════════════════════════════
   Settings cache helpers
   The app writes settings here so the SW can read them even
   when the page is not open (Cache API survives page close).
══════════════════════════════════════════════════════════════ */
async function readSettings() {
  try {
    const cache = await caches.open(SETTINGS_KEY);
    const resp  = await cache.match('settings.json');
    if (!resp) return null;
    return await resp.json();
  } catch { return null; }
}

async function patchSettings(patch) {
  try {
    const cache   = await caches.open(SETTINGS_KEY);
    const current = await readSettings() || {};
    const updated = { ...current, ...patch };
    await cache.put('settings.json', new Response(JSON.stringify(updated), {
      headers: { 'Content-Type': 'application/json' }
    }));
  } catch {}
}

/* ══════════════════════════════════════════════════════════════
   Periodic Background Sync
   Chrome on Android wakes this SW ~once per day even when the
   app is fully closed / killed. minInterval = 12 h gives two
   chances per day in case the first fires early.
══════════════════════════════════════════════════════════════ */
self.addEventListener('periodicsync', event => {
  if (event.tag === 'piggy-daily-checkin') {
    event.waitUntil(handleDailySync());
  }
});

async function handleDailySync() {
  if (Notification.permission !== 'granted') return;

  const settings = await readSettings();
  if (!settings) return;

  // Don't double-notify on the same calendar day
  const today = new Date().toDateString();
  if (settings.lastNotifDate === today) return;

  // Also skip if user already checked in today
  if (settings.lastCheckInDate === today) return;

  // Respect user's chosen reminder time
  const now = new Date();
  const [targetH, targetM] = (settings.notifTime || '09:00').split(':').map(Number);
  const nowMins    = now.getHours() * 60 + now.getMinutes();
  const targetMins = targetH * 60 + targetM;
  if (nowMins < targetMins) return;

  await self.registration.showNotification('🐷 Daily Piggy Bank', {
    body:     `Did you complete your ${settings.taskName || 'daily task'} today? Tap to log it! 💰`,
    icon:     './icon.svg',
    badge:    './icon.svg',
    tag:      'daily-checkin',
    renotify: true,
    vibrate:  [200, 100, 200],
    data:     { url: './' }
  });

  // Record so we don't fire again today
  await patchSettings({ lastNotifDate: today });
}

/* ── Notification click: open / focus the app ──────────────────────────────── */
self.addEventListener('notificationclick', event => {
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow('./index.html?action=checkin');
    })
  );
});

/* ── Push (server-sent, future-ready hook) ──────────────────────────────────── */
self.addEventListener('push', event => {
  const data  = event.data ? event.data.json() : {};
  const title = data.title || '🐷 Daily Piggy Bank';
  const body  = data.body  || "Don't forget to log today's task!";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon:      './icon.svg',
      badge:     './icon.svg',
      tag:       'daily-checkin',
      renotify:  true,
      vibrate:   [200, 100, 200]
    })
  );
});
