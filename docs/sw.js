const CACHE_NAME = 'week-task-tracker-v1';
// Add all the files you want to cache
const FILES_TO_CACHE = [
  '/',
  'index.html',
  'styles.css',
  'script.js'
  // Add paths to your icons once you create them
  // 'icons/icon-192.png',
  // 'icons/icon-512.png'
];

// 1. On install, cache all the app shell files
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Service Worker: Caching app shell');
        return cache.addAll(FILES_TO_CACHE);
      })
  );
});

// 2. On fetch, serve from cache first
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // If it's in the cache, return it.
        // If not, fetch from the network.
        return response || fetch(event.request);
      })
  );
});