/**
 * Service Worker для ЗооКонтроль PWA.
 *
 * Стратегия кэширования:
 *  - Статическая оболочка (index.html, манифест, иконки) — кэшируется при установке (cache-first).
 *  - Остальные статические ассеты (JS/CSS бандлы) — кэшируются при первом запросе (cache-first).
 *  - Запросы к Firebase и серверному API — НЕ кэшируются (network-only).
 *  - Персональные данные клиентов, токены и результаты авторизованных запросов — НЕ кэшируются.
 */

const CACHE_NAME = 'zoo-control-shell-v7';
// ?v=3 — единый набор иконок (щит в щите с лапой животного).
const SHELL_URLS = [
  './',
  './index.html',
  './manifest.json?v=3',
  './favicon.svg?v=3',
  './favicon.ico?v=3',
  './favicon-16.png?v=3',
  './favicon-32.png?v=3',
  './favicon-48.png?v=3',
  './apple-touch-icon.png?v=3',
  './icon.svg?v=3',
  './icon-192.png?v=3',
  './icon-512.png?v=3',
  './maskable-icon-192.png?v=3',
  './maskable-icon-512.png?v=3',
];

// Путь оболочки считается от самого скрипта: service worker может лежать
// не в корне домена (GitHub Pages: /ZOO_opt/sw.js).
const SHELL_INDEX = new URL('index.html', self.registration.scope).href;

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

  // Внешние (cross-origin) запросы не перехватываем: их обрабатывает браузер.
  // Иначе неудачный fetch (например, при отсутствии сети) даёт
  // "FetchEvent ... resulted in a network error response".
  if (new URL(url).origin !== self.location.origin) {
    return;
  }

  // Никогда не кэшируем и не перехватываем запросы к Firebase / API.
  if (isUncacheable(url)) {
    return;
  }

  // Навигация — network-first с fallback на оболочку.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(SHELL_INDEX, clone));
          }
          return response;
        })
        .catch(() => caches.match(SHELL_INDEX)),
    );
    return;
  }

  // Статические ассеты — cache-first с безопасным fallback при ошибке сети.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then(
            (fallback) => fallback || new Response('', { status: 504, statusText: 'Gateway Timeout' }),
          ),
        );
    }),
  );
});