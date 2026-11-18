// --- FILE: frontend/public/sw.js ---
// Сервис-воркер приложения (таск 24.2). Задача скромная: установка на главный экран и честная офлайн-страница, а не
// игра без сети — партии, задачи и разбор живут на сервере.
//
// * Переходы по страницам — сначала сеть; без сети — /offline.html (на трёх языках, свой скрипт: CSP запрещает
//   встроенные).
// * Файлы сборки и картинки (/assets/, /icons/) — из кэша, если уже были загружены: имена сборки Vite с хэшем не
//   меняются, а фигуры и текстуры кэшируются по мере показа.
// * /api/ и всё чужое не трогаем: ответы сервера не должны устаревать в кэше.
// Новая версия файла (VERSION) при следующем открытии удаляет старые кэши.

const VERSION = 'v1';
const SHELL_CACHE = `regence-shell-${VERSION}`;
const ASSET_CACHE = `regence-assets-${VERSION}`;
const OFFLINE_URL = '/offline.html';
const SHELL = [OFFLINE_URL, '/offline.js', '/favicon.svg', '/icons/icon-192.png', '/manifest.webmanifest'];
// Сколько файлов держать в кэше картинок и сборки: старые версии сборки и редкие фигуры вытесняются.
const ASSET_LIMIT = 300;

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys
                // Кэши прежнего имени платформы (michess-…, до 18.11.2026) тоже удаляются.
                .filter((key) => (key.startsWith('regence-') || key.startsWith('michess-')) && key !== SHELL_CACHE && key !== ASSET_CACHE)
                .map((key) => caches.delete(key))))
            .then(() => self.clients.claim()),
    );
});

async function trim(cache) {
    const keys = await cache.keys();
    await Promise.all(keys.slice(0, Math.max(0, keys.length - ASSET_LIMIT)).map((key) => cache.delete(key)));
}

async function fromCacheOrNetwork(request) {
    // Сначала во всех кэшах: файлы офлайн-страницы лежат в кэше оболочки.
    const cached = await caches.match(request);
    if (cached) return cached;
    const cache = await caches.open(ASSET_CACHE);
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
        await cache.put(request, response.clone());
        trim(cache).catch(() => undefined);
    }
    return response;
}

async function pageOrOffline(request) {
    try {
        return await fetch(request);
    } catch {
        const offline = await caches.match(OFFLINE_URL);
        return offline ?? Response.error();
    }
}

self.addEventListener('fetch', (event) => {
    const {request} = event;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
    if (request.mode === 'navigate') {
        event.respondWith(pageOrOffline(request));
        return;
    }
    if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || SHELL.includes(url.pathname)) {
        event.respondWith(fromCacheOrNetwork(request));
    }
});
