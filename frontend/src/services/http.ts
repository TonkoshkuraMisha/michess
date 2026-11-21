// --- FILE: frontend/src/services/http.ts ---
// Общий запрос к API сервера (/api/v1/…) для модулей services/*.ts: адрес из config/api.ts (API_BASE_URL), токен входа
// из authToken.ts, если игрок вошёл (без входа запрос уходит без него — открытые разделы сервер отдаёт и так), JSON-тело
// с заголовком Content-Type. Отказ сервера превращается в UiError с текстом по коду ошибки (apiErrors.ts, коды —
// src/core/errors.py); сеть недоступна — UiError «нет связи». Компоненты в сеть сами не ходят: они вызывают сервис,
// а сервис — apiRequest (ответ JSON) или apiFetch (ответ целиком: текст PGN, заголовки) (правило проекта: компонент
// рисует, services/*.ts ходит в сеть).

import {API_BASE_URL} from '../config/api';
import {uiMessage} from '../i18n';
import type {MessageKey} from '../i18n';
import {readApiErrorOr, UiError} from './apiErrors';
import {getToken} from './authToken';
import {addBreadcrumb, CLIENT_ERRORS_PATH, newRequestId} from './breadcrumbs';

/** HTTP-ответ «без содержимого»: такой запрос возвращает undefined, тела у него нет. */
const NO_CONTENT = 204;

/** Запасной текст отказа: ключ каталога или ключ по HTTP-статусу (например, 429 от прокси без тела). */
export type Fallback = MessageKey | ((status: number) => MessageKey);

/** Полный адрес пути API — для ссылок (href скачивания PGN и т. п.), а не для запросов из кода. */
export const apiUrl = (path: string) => `${API_BASE_URL}/api/v1${path}`;

/**
 * Запрос к /api/v1{path}; ответ — проверенный Response (статус 2xx), тело читает вызывающий: текст, заголовки.
 * Заголовки из init дополняют общие (токен и Content-Type), а не заменяют их.
 */
export async function apiFetch(path: string, init: RequestInit = {}, fallback: Fallback = 'common.networkError'): Promise<Response> {
    const token = getToken();
    // Сквозной номер запроса: сервер пишет его в каждую строку журнала и возвращает в X-Request-ID; он же — в отчётах
    // об ошибках страницы (clientErrors.ts). Запросы самих отчётов в след не пишутся.
    const requestId = newRequestId();
    const tracked = path !== CLIENT_ERRORS_PATH;
    const label = `${init.method ?? 'GET'} ${path.split('?')[0]}`;
    let res: Response;
    try {
        res = await fetch(apiUrl(path), {
            ...init,
            headers: {
                ...(typeof init.body === 'string' ? {'Content-Type': 'application/json'} : {}),
                ...(token ? {Authorization: `Bearer ${token}`} : {}),
                'X-Request-ID': requestId,
                ...(init.headers as Record<string, string> | undefined),
            },
        });
    } catch {
        if (tracked) addBreadcrumb('request', `${label} (no connection)`, {request_id: requestId});
        throw new UiError(uiMessage('common.noConnection'));
    }
    if (tracked) addBreadcrumb('request', label, {status: res.status, request_id: requestId});
    if (!res.ok) throw new UiError(await readApiErrorOr(res, typeof fallback === 'function' ? fallback(res.status) : fallback));
    return res;
}

/** Запрос к /api/v1{path}; ответ — разобранный JSON (204 — undefined). fallback — текст отказа без известного кода. */
export async function apiRequest<T>(path: string, init: RequestInit = {}, fallback: Fallback = 'common.networkError'): Promise<T> {
    const res = await apiFetch(path, init, fallback);
    if (res.status === NO_CONTENT) return undefined as T;
    return res.json() as Promise<T>;
}
