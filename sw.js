/* StartPage Mobile — service worker.
 * Caches the app SHELL (the single-file engine + wizard + icons) so the app
 * launches and runs fully on-device/offline after the first load. Live data
 * (Yahoo / AI / the Cloudflare Worker) is cross-origin and is NEVER cached —
 * those requests always hit the network so prices are never stale, matching the
 * dashboard's own "no stale prices" rule.
 *
 * UPDATE STRATEGY (why a reload now reflects a new deploy on the FIRST reload):
 *   - The app ENGINE (HTML documents + config.json) is NETWORK-FIRST: when
 *     online, a reload always fetches the freshest engine from the server and
 *     only falls back to cache when offline. The previous stale-while-revalidate
 *     served the OLD cached engine first and refreshed in the background, so a
 *     change needed ~two reloads to appear.
 *   - The vendored libs + icons (qrcode.js, jsQR.js, *.png) rarely change and
 *     are large, so they stay stale-while-revalidate for a fast launch. A CACHE
 *     bump on each deploy re-populates them from the network during install, so
 *     they can never be stale-vs-engine across a deploy.
 *
 * Bump CACHE when the shell changes so old caches are evicted on activate.
 */
const CACHE = 'startpage-shell-v12';
const SHELL = [
  './',
  './index.html',
  './wizard.html',
  './config.json',
  './qrcode.js',
  './jsQR.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon-180.png'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // never touch POSTs (AI calls etc.)
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;        // let cross-origin data/AI/Worker hit network directly

  // Cache the network response (best-effort) and return it.
  const putThenReturn = (resp) => {
    if (resp && resp.ok) {
      const copy = resp.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
    }
    return resp;
  };

  // The ENGINE (HTML documents + config.json): NETWORK-FIRST so a single reload
  // reflects the latest deploy when online; cache is the offline fallback.
  const p = url.pathname;
  const isEngine = p === '/' || p.endsWith('/') || p.endsWith('.html') || p.endsWith('config.json');
  if (isEngine) {
    e.respondWith(fetch(req).then(putThenReturn).catch(() => caches.match(req)));
    return;
  }

  // Vendored libs + icons: stale-while-revalidate (fast launch, refreshed in
  // the background; re-fetched fresh on every CACHE bump via install addAll).
  e.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req).then(putThenReturn).catch(() => cached);
      return cached || net;
    })
  );
});
