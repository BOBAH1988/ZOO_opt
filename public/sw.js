/**
 * Service Worker для ЗОО Opt PWA.
 *
 * Стратегия кэширования:
 *  - Статическая оболочка (index.html, манифест, иконки) — кэшируется при установке (cache-first).
 *  - Остальные статические ассеты (JS/CSS бандлы) — кэшируются при первом запросе (cache-first).
 *  - Запросы к Firebase и серверному API — НЕ кэшируются (network-only).
 *  - Персональные данные клиентов, токены и результаты авторизованных запросов — НЕ кэшируются.
 */

const CACHE_NAME = 'zoo-opt-shell-v1';
const SHELL_URLS = [
  '/ZOO_opt/',
  '/ZOO_opt/index.html',
  '/ZOO_opt/icons/icon-192.svg',
  '/ZOO_opt/icons/icon-512.svg',
  '/ZOO_opt/manifest.json',
];

// Firebase и GitHub API — никогда не кэшируем.
const UNCACHEABLE_PATTERNS = [
  'firebaseio.com',
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'api.github.com',
  'github.com',
];

function isUncacheable(url: string): boolean {
  return UNCACHEABLE_PATTERNS.some((p) => url.includes(p));
}

self.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)),
  );
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
      ),
    ),
  );
});

self.addEventListener('fetch', (event: FetchEvent) => {
  const { request } = event;
  const url = request.url;

  // Никогда не кэшируем запросы к Firebase / GitHub API.
  if (isUncacheable(url)) {
    return;
  }

  // Статические ассеты — cache-first.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(request).then((response) => {
        // Кэшируем только успешные GET-запросы к нашему origins (статика).
        if (
          response.status === 200 &&
          request.method === 'GET' &&
          new URL(url).origin === self.location.origin
        ) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
        }
        return response;
      });
    }),
  );
});

export {};