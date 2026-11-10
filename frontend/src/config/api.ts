// --- FILE: frontend/src/config/api.ts ---

/**
 * Адреса API и WebSocket.
 *
 * Разработка: Vite (порт 3000) и uvicorn (порт 8000) — разные адреса, по умолчанию 127.0.0.1:8000.
 * Продакшен (сборка за nginx): фронтенд и API на одном домене, поэтому по умолчанию API —
 * относительный путь, а WebSocket — тот же хост с ws/wss по протоколу страницы.
 * VITE_API_URL / VITE_WS_URL переопределяют оба варианта.
 */

const DEV_API_URL = 'http://127.0.0.1:8000';
const DEV_WS_URL = 'ws://127.0.0.1:8000';

function sameOriginWsUrl(): string {
    if (typeof window === 'undefined' || !window.location) return DEV_WS_URL;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}`;
}

export const API_BASE_URL: string =
    import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? '' : DEV_API_URL);

export const WS_BASE_URL: string =
    import.meta.env.VITE_WS_URL || (import.meta.env.PROD ? sameOriginWsUrl() : DEV_WS_URL);
