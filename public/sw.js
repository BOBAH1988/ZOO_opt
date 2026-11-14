/**
 * Service Worker для ЗооКонтроль PWA.
 *
 * Стратегия кэширования:
 *  - Статическая оболочка (index.html, манифест, иконки) — кэшируется при установке (cache-first).
 *  - Остальные статические ассеты (JS/CSS бандлы) — кэшируются при первом запросе (cache-first).
 *  - Запросы к Firebase и серверному API — НЕ кэшируются (network-only).
 *  - Персональные данные клиентов, токены и результаты авторизованных запросов — НЕ кэшируются.
 */

const CACHE_NAME = 'zoo-control-shell-v4';
const SHELL_URLS = [
  '/ZOO_opt/',
  '/ZOO_opt/index.html',
  '/ZOO_opt/manifest.json',
  '/ZOO_opt/favicon.svg',
  '/ZOO_opt/favicon-16.png',
  '/ZOO_opt/favicon-32.png',
  '/ZOO_opt/favicon-48.png',
  '/ZOO_opt/apple-touch-icon.png',
  '/ZOO_opt/icon.svg',
  '/ZOO_opt/icon-192.png',
  '/ZOO_opt/icon-512.png',
  '/ZOO_opt/maskable-icon-192.png',
  '/ZOO_opt/maskable-icon-512.png',
];

// Firebase, API и внешние сервисы — никогда не кэшируем.
const UNCACHEABLE_PATTERNS = [
  'firebaseio.com',
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'googleapis.com',
  'api.github.com',
  'github.com',
  '/run',
];

function isUncacheable(url) {
  return UNCACHEABLE_PATTERNS.some((p) => url.includes(p));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)).catch((err) => {
      console.error('Service Worker install failed:', err);
    }),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = request.url;

  if (request.method !== 'GET') {
    return;
  }

  // Никогда не кэшируем запросы к Firebase / API.
  if (isUncacheable(url)) {
    event.respondWith(fetch(request));
    return;
  }

  // Навигация — network-first с fallback на оболочку.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/ZOO_opt/index.html', clone));
          }
          return response;
        })
        .catch(() => caches.match('/ZOO_opt/index.html')),
    );
    return;
  }

  // Статические ассеты — cache-first.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (
          response &&
          response.status === 200 &&
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