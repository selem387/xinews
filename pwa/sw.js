// Service worker: la app funciona sin internet con lo último que se vio (respaldo para la demo)
const V = 'xinews-v4';
const SHELL = ['./', 'index.html', 'styles.css', 'galeria.css', 'menos1.css', 'app.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/placeholder.svg', 'icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V && !k.startsWith('xinews-img')).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // API: red primero, caché si falla
  if (url.pathname.startsWith('/v1/') && !url.pathname.startsWith('/v1/img/') && !url.pathname.startsWith('/v1/click/')) {
    e.respondWith(fetch(req).then((r) => { const cp = r.clone(); caches.open(V + '-api').then((c) => c.put(req, cp)); return r; })
      .catch(() => caches.open(V + '-api').then((c) => c.match(req)).then((m) => m || Response.error())));
    return;
  }
  // Imágenes: caché primero, luego red (y se guarda)
  if (req.destination === 'image') {
    e.respondWith(caches.open('xinews-img').then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      try { const r = await fetch(req, { mode: 'no-cors' }); c.put(req, r.clone()); return r; }
      catch { return caches.match('icons/placeholder.svg'); }
    }));
    return;
  }
  // Shell: caché con actualización en segundo plano
  if (url.origin === location.origin) {
    e.respondWith(caches.match(req).then((hit) => {
      const net = fetch(req).then((r) => { caches.open(V).then((c) => c.put(req, r.clone())); return r; }).catch(() => hit);
      return hit || net;
    }));
  }
});
