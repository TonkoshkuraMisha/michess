// --- FILE: frontend/src/services/http.ts ---
// Общий запрос к API сервера (/api/v1/…) для модулей services/*.ts: адрес из config/api.ts (API_BASE_URL), токен входа
// из authToken.ts, если игрок вошёл (без входа запрос уходит без него — открытые разделы сервер отдаёт и так), JSON-тело
// с заголовком Content-Type. Отказ сервера превращается в UiError с текстом по коду ошибки (apiErrors.ts, коды —
// src/core/errors.py); сеть недоступна — UiError «нет связи». Компоненты в сеть сами не ходят: они вызывают сервис,
// а сервис — apiRequest (правило проекта: компонент рисует, services/*.ts ходит в сеть).

import {API_BASE_URL} from '../config/api';
import {uiMessage} from '../i18n';
import type {MessageKey} from '../i18n';
import {readApiErrorOr, UiError} from './apiErrors';
import {getToken} from './authToken';

/** HTTP-ответ «без содержимого»: такой запрос возвращает undefined, тела у него нет. */
const NO_CONTENT = 204;

/**
 * Запрос к /api/v1{path}; ответ — разобранный JSON. fallback — текст, если сервер отказал без известного кода;
 * может зависеть от HTTP-статуса (например, 429 от прокси без тела — «слишком много попыток»).
 * Заголовки из init дополняют общие (токен и Content-Type), а не заменяют их.
 */
export async function apiRequest<T>(path: string, init: RequestInit = {},
                                    fallback: MessageKey | ((status: number) => MessageKey) = 'common.networkError'): Promise<T> {
    const token = getToken();
    let res: Response;
    try {
        res = await fetch(`${API_BASE_URL}/api/v1${path}`, {
            ...init,
            headers: {
                ...(typeof init.body === 'string' ? {'Content-Type': 'application/json'} : {}),
                ...(token ? {Authorization: `Bearer ${token}`} : {}),
                ...(init.headers as Record<string, string> | undefined),
            },
        });
    } catch {
        throw new UiError(uiMessage('common.noConnection'));
    }
    if (!res.ok) throw new UiError(await readApiErrorOr(res, typeof fallback === 'function' ? fallback(res.status) : fallback));
    if (res.status === NO_CONTENT) return undefined as T;
    return res.json() as Promise<T>;
}
