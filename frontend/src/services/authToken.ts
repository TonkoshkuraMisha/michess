// --- FILE: frontend/src/services/authToken.ts ---
// Токен входа (таск 17.5). Короткий access-токен живёт только в памяти страницы — внедрённый скрипт (XSS) не найдёт
// его в localStorage; долгий вход держит refresh-токен в httpOnly-cookie, которую JavaScript не видит вовсе.
// При загрузке страницы сессия восстанавливается по cookie (restoreSession), за минуту до истечения токен
// обновляется сам; неудачное обновление — выход (событие michess-auth-expired).

import {API_BASE_URL} from '../config/api';

const LEGACY_STORAGE_KEY = 'token';
const REFRESH_AHEAD_MS = 60_000;
export const AUTH_EXPIRED_EVENT = 'michess-auth-expired';

let current: string | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<string | null> | null = null;
const listeners = new Set<(token: string | null) => void>();

/** Токен из прежних версий в localStorage больше не используется: он жил сутки и был доступен скриптам. */
function dropLegacyToken(): void {
    try {
        localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
        // хранилище недоступно — и так ничего не лежит
    }
}

/** Момент истечения JWT (мс) из поля exp; null — не разобрать. */
function expiresAt(token: string): number | null {
    try {
        const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
    } catch {
        return null;
    }
}

function schedule(token: string | null): void {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = null;
    const exp = token ? expiresAt(token) : null;
    if (exp === null) return;
    refreshTimer = setTimeout(() => {
        void refreshSession().then((fresh) => {
            if (!fresh) window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
        });
    }, Math.max(1_000, exp - Date.now() - REFRESH_AHEAD_MS));
}

export function getToken(): string | null {
    return current;
}

export function setToken(token: string | null): void {
    current = token;
    schedule(token);
    listeners.forEach((listener) => listener(token));
}

/** Забыть токен (выход, истёкшая сессия). Cookie на сервере стирает logout(). */
export function clearToken(): void {
    setToken(null);
}

export function onTokenChange(listener: (token: string | null) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Новый access-токен по refresh-cookie; одновременные вызовы делят один запрос. null — сессии нет. */
export function refreshSession(): Promise<string | null> {
    if (!inFlight) {
        const before = current;
        inFlight = fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {method: 'POST', credentials: 'include'})
            .then(async (res) => (res.ok ? ((await res.json()).access_token as string) : null))
            .catch(() => null)
            .then((token) => {
                // Пока шёл запрос, игрок мог войти заново — неудача не стирает свежий токен.
                if (token) setToken(token);
                else if (current === before) setToken(null);
                return token;
            })
            .finally(() => {
                inFlight = null;
            });
    }
    return inFlight;
}

/** При загрузке страницы: убрать старый токен из localStorage и восстановить вход по cookie. */
export function restoreSession(): Promise<string | null> {
    dropLegacyToken();
    return current ? Promise.resolve(current) : refreshSession();
}

/** Выход на этом устройстве: сессия на сервере удаляется, токен забывается. */
export async function logout(): Promise<void> {
    clearToken();  // интерфейс выходит сразу, не дожидаясь сервера
    try {
        await fetch(`${API_BASE_URL}/api/v1/auth/logout`, {method: 'POST', credentials: 'include'});
    } catch {
        // без сети сессия на сервере истечёт сама; локально выход уже выполнен
    }
}
