/**
 * Service Worker : GlucoScan Maroc (PWA Hors-Ligne & Cache Rapide)
 */
const CACHE_NAME = 'glucoscan-v25';
// Les modules sont importés avec un paramètre de version (?v=31) : la recherche dans le cache
// ignore la query string (ignoreSearch) pour que le précache serve aussi ces URL hors-ligne.
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/lib/lucide.min.js',
  './js/app.js',
  './js/data/foods.js',
  './js/ui/renderer.js',
  './js/services/metabolicEngine.js',
  './js/services/profileService.js',
  './js/services/storage.js',
  './js/services/supabaseClient.js',
  './js/services/visionAnalyzer.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Mise en cache fichier par fichier : un échec isolé n'annule pas tout le précache
      return Promise.all(ASSETS_TO_CACHE.map((url) =>
        cache.add(url).catch((err) => console.warn('[SW] Précache impossible :', url, err))
      ));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((k) => {
          if (k !== CACHE_NAME) {
            return caches.delete(k);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Ignorer les requêtes non-GET, cross-origin (API Supabase/Gemini, CDN) et les endpoints d'API Edge
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return;
  }

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
      if (cachedResponse) {
        // En arrière-plan, rafraîchir le cache (Stale-While-Revalidate)
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
          }
        }).catch(() => {});
        return cachedResponse;
      }

      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return networkResponse;
      }).catch(() => {
        // Fallback hors-ligne pour la page principale
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
