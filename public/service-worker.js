/**
 * Retired service worker.
 *
 * The previous PWA caching layer could keep stale admin shells alive across
 * deployments. This worker now removes all Light Engine caches and unregisters
 * itself so Cloud Run becomes the only source of truth for the UI.
 */

const CACHE_PREFIX = 'light-engine-';
const RETIRED_VERSION = 'retired-20260419b';

async function clearRetiredCaches() {
  const cacheNames = await caches.keys();
  await Promise.all(
    cacheNames
      .filter((cacheName) => cacheName.startsWith(CACHE_PREFIX))
      .map((cacheName) => caches.delete(cacheName))
  );
}

async function retireWorker() {
  await clearRetiredCaches();
  await self.clients.claim();

  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach((client) => {
    client.postMessage({ type: 'SERVICE_WORKER_RETIRED', version: RETIRED_VERSION });
  });

  await self.registration.unregister();
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(retireWorker());
});

self.addEventListener('message', (event) => {
  if (event.data && (event.data.type === 'CLEAR_CACHE' || event.data.type === 'RETIRE_WORKER')) {
    event.waitUntil((async () => {
      await clearRetiredCaches();
      if (event.ports && event.ports[0]) {
        event.ports[0].postMessage({
          success: true,
          message: 'Retired service worker caches cleared',
          version: RETIRED_VERSION,
        });
      }
    })());
  }
});
