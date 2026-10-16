/* Service worker de Fibre Guardian : l'application s'installe et s'ouvre même sans réseau.
   Les pages et fichiers passent d'abord par le réseau (jamais de version périmée en ligne),
   le cache ne sert qu'en secours. Les données (/api/) ne sont jamais mises en cache. */
'use strict';
const CACHE = 'fibre-guardian-v3';
const SHELL = ['./', './index.html', './offline.html', './bootstrap.js', './manifest.webmanifest', './pwa/icon-192.png', './pwa/icon-512.png', '../vendor/fonts.css', './moov-theme.css', './moov-brand.css'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('fibre-guardian-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

function cacheable(url) {
  return url.origin === self.location.origin && !url.pathname.startsWith('/api/') && /^\/(codex|src|vendor)\//.test(url.pathname);
}

// La page envoie la liste des fichiers qu'elle a chargés : ils sont gardés pour le mode hors ligne.
self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type !== 'guardian-cache' || !Array.isArray(data.urls)) return;
  const urls = data.urls.slice(0, 300).map(u => { try { return new URL(u, self.location.href); } catch (_) { return null; } }).filter(u => u && cacheable(u));
  event.waitUntil(caches.open(CACHE).then(cache => Promise.all(urls.map(u => cache.match(u.href).then(hit => hit || cache.add(u.href).catch(() => null))))));
});

self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('./offline.html')));
    return;
  }
  if (!cacheable(url)) return;
  event.respondWith(fetch(request).then(response => {
    if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(request, copy)); }
    return response;
  }).catch(() => caches.match(request, { ignoreSearch: true }).then(hit => hit || Response.error())));
});
