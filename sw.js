/* Service worker : l'application s'installe et se relance sans réseau (ENF-6, ENF-7, ENF-9). */
const CACHE = 'fibre-guardian-v2';
const ASSETS = [
  './', 'index.html', 'support.js', 'config.js', 'manifest.webmanifest', 'icon.svg',
  'vendor/react.production.min.js', 'vendor/react-dom.production.min.js', 'vendor/three.min.js', 'vendor/fonts.css',
  'vendor/fonts/archivo-latin-wdth-normal.woff2', 'vendor/fonts/archivo-latin-ext-wdth-normal.woff2',
  'src/engine.js', 'src/fleet.js', 'src/agent.js', 'src/vision.js',
  'src/lang/manifest.js', 'src/lang/fr.js', 'src/lang/nouchi.js', 'src/lang/dioula.js',
  '_ds/modernist-da9dc39f-b72e-42e4-b95b-0d120008c7d5/styles.css', '_ds/modernist-da9dc39f-b72e-42e4-b95b-0d120008c7d5/_ds_bundle.js',
];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.includes('/api/')) return;
  // Réseau d'abord pour avoir la dernière version, cache si hors ligne.
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(k => k.put(e.request, c)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
