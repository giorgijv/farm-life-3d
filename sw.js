/* Farm Life service worker.
 *
 * The game is a handful of static files plus a set of vendored 3D models, all
 * served from this origin, so the whole app shell is precached on install and
 * the game runs fully offline.
 *
 * Bump CACHE_VERSION whenever the shell changes; the activate step clears
 * every older cache.
 */

const CACHE_VERSION = 'farm-life-3d-v9';

// Relative so the worker works both at a domain root and under a project
// path such as /farm-game/ on GitHub Pages.
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './script.js',
  './scene.js',
  './assets.js',
  './vendor/three.module.js',
  './assets/manifest.json',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

/* The models and three.js's own jsm modules are listed in
   assets/manifest.json rather than here, because tools/vendor.mjs writes that
   file and would otherwise be editing this one too. The models are under 2 MB
   all told (see docs/ART_BIBLE.md), which is what makes precaching the set
   reasonable rather than loading it lazily and losing the offline promise for
   anyone who hasn't walked past a cow yet. */
async function assetUrls() {
  try {
    const res = await fetch('./assets/manifest.json', { cache: 'no-cache' });
    if (!res.ok) return [];
    const manifest = await res.json();
    return [manifest.files, manifest.vendor].flatMap((l) => (Array.isArray(l) ? l : []));
  } catch {
    // An install that can't read the manifest still gets a playable shell.
    return [];
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      const urls = [...SHELL, ...(await assetUrls())];
      // Individually, so one failed entry cannot abort the whole install.
      await Promise.allSettled(urls.map((url) => cache.add(url)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations go to the network first so a deployed update is picked up
  // promptly, falling back to the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match('./index.html'))),
    );
    return;
  }

  // Everything else: serve from cache, and refresh the entry in the
  // background so the next load gets any newer copy.
  event.respondWith(
    caches.match(request).then((hit) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => hit);
      return hit || network;
    }),
  );
});
