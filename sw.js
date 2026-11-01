// Service worker: keeps the app itself available offline and caches photos.
const VERSION = '20261101135854';
const SHELL = `shell-${VERSION}`, PHOTOS = 'photos-v1';
const FILES = ['./', 'index.html', 'styles.css', 'app.js', 'db.js', 'images.js', 'icons.js', 'draft.js', 'config.js', 'vendor/supabase.js', 'vendor/heic-to.js',
  'manifest.webmanifest', 'fonts/unifraktur-maguntia.woff2', 'fonts/pirata-one.woff2', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== PHOTOS).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Photos never change once uploaded (each has a unique name): cache first.
  if (url.pathname.includes('/storage/v1/object/public/')) {
    e.respondWith(caches.open(PHOTOS).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) { c.put(req, res.clone()); trim(c, 600); }
      return res;
    }));
    return;
  }
  // The app's own files: network first (so updates show up), fall back to cache offline.
  if (url.origin === self.location.origin) {
    e.respondWith(fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
  }
  // Everything else (database, sign-in) goes straight to the network.
});
