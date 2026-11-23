/* Service worker de Fibre Guardian : l'application s'installe et s'ouvre même sans réseau.
   Les pages et fichiers passent d'abord par le réseau (jamais de version périmée en ligne),
   le cache ne sert qu'en secours. Les données (/api/) ne sont jamais mises en cache. */
'use strict';
const CACHE = 'fibre-guardian-v41';
const SHELL = ['./', './index.html', './offline.html', './bootstrap.js', './apparence.js', './icones.js', './manifest.webmanifest', './pwa/icon-192.png', './pwa/icon-512.png', '../vendor/fonts.css', './moov-theme.css', './moov-brand.css', './fonts.css', './refonte.css', './guardian-chat.css', './live-trip.css', './landing.css','./client-home.css','./tech-view.css','./avatars.css', './plan-view.css', './survie.css', './essentiel.css', './accueil.css', './ecrans-client.css', './push.css', './design-system.css'];

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

// Alerte reçue application fermée (push.cjs) : le téléphone l'affiche toujours (Safari retire l'autorisation sinon).
self.addEventListener('push', event => {
  let m = {};
  try { m = event.data ? event.data.json() : {}; } catch (_) { m = {body: event.data ? event.data.text() : ''}; }
  const title = String(m.title || 'Fibre Guardian').slice(0, 120);
  const opts = {body: String(m.body || '').slice(0, 400), icon: './pwa/icon-192.png', badge: './pwa/icon-192.png', data: {url: m.url || './'}};
  if (m.tag) { opts.tag = String(m.tag).slice(0, 120); opts.renotify = true; }
  event.waitUntil(self.registration.showNotification(title, opts));
});

// Toucher une notification de Guardian : l'application s'ouvre sur le bon écran (alerte Wi-Fi : écran Appareils).
// Seules les adresses de l'application sont ouvertes.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const base = new URL('./', self.location.href).href, data = event.notification.data || {};
  let target = new URL('./?section=' + encodeURIComponent(data.page || 'devices'), self.location.href).href;
  if (data.url) { try { const u = new URL(data.url, self.location.href); if (u.href.startsWith(base)) target = u.href; } catch (_) {} }
  event.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(list => {
    const open = list.find(c => c.url.startsWith(base));
    if (open) return open.focus().then(c => (c || open).navigate ? (c || open).navigate(target) : null).catch(() => null);
    return self.clients.openWindow(target);
  }));
});
