'use strict';
// Service worker: guarda el "cascarón" de la app para abrir sin conexión.
// Nunca guarda api/ (datos de la casa): eso va siempre a la red. Las rutas son relativas al scope (Ingress de HA).
const VERSION = 'v4';
const CACHE = 'replicator-shell-' + VERSION;
const SHELL = [
  './', 'index.html', 'manifest.webmanifest',
  'assets/css/app.css', 'assets/js/ui.js', 'assets/js/api.js', 'assets/js/ia.js', 'assets/js/perfil.js', 'assets/js/casa.js', 'assets/js/baja.js', 'assets/js/lista.js', 'assets/js/impuestos.js', 'assets/js/gastos.js','assets/js/app.js',
  'assets/icons/icon.svg', 'assets/icons/icon-192.png', 'assets/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith(new URL('api/', self.registration.scope).pathname)) return;
  // Red primero (siempre la versión nueva si hay conexión); si falla, el cascarón guardado.
  e.respondWith(
    fetch(req, { cache: 'no-store' }).then((r) => {
      if (r.ok) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(req, copia)); }
      return r;
    }).catch(() => caches.match(req).then((r) => r || caches.match('index.html'))));
});
