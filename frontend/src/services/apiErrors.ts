// --- FILE: frontend/src/services/apiErrors.ts ---
// Ошибки сервера → сообщения на языке игрока. Сервер отдаёт код, параметры и английский текст
// (src/core/errors.py); текст для игрока берётся из каталога serverErrors по коду. Английский текст
// сервера показывается, только если клиент такого кода ещё не знает (например, устаревшая вкладка).

import {hasMessage, uiMessage} from '../i18n';
import type {MessageKey, MessageParam, UiMessage} from '../i18n';

type Params = Record<string, MessageParam>;

function primitiveParams(raw: unknown): Params {
    const params: Params = {};
    if (raw && typeof raw === 'object') {
        for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
            if (typeof value === 'string' || typeof value === 'number') params[name] = value;
            else if (typeof value === 'boolean') params[name] = String(value);
        }
    }
    return params;
}

/** Ошибка по коду сервера: из каталога, а если код неизвестен — английский текст сервера. */
export function serverErrorMessage(code: unknown, params?: unknown, message?: unknown): UiMessage | null {
    const key = `serverErrors.${String(code)}`;
    if (typeof code === 'string' && hasMessage(key)) return uiMessage(key, primitiveParams(params));
    return typeof message === 'string' && message ? {text: message} : null;
}

/** Ошибка проверки поля (422): своя проверка сервера — по коду, стандартная — по типу из каталога validation. */
function validationItemMessage(item: unknown): UiMessage | null {
    if (!item || typeof item !== 'object') return null;
    // Английский msg сервера не показываем: тип проверки и её параметры переводятся каталогом.
    const {type, loc, params} = item as { type?: unknown; loc?: unknown; params?: unknown };
    const fromCode = serverErrorMessage(type, params);
    let message: UiMessage | null = fromCode;
    if (!message) {
        const key = `validation.${String(type)}`;
        message = hasMessage(key)
            ? uiMessage(key as MessageKey, primitiveParams(params))
            : uiMessage('validation.invalid_value');
    }
    const field = Array.isArray(loc) ? loc.filter((part) => typeof part === 'string').at(-1) : undefined;
    // Корень тела запроса («body») — не поле; проверка модели целиком подписи поля не получает.
    if (typeof field === 'string' && field !== 'body') {
        const fieldKey = `fields.${field}`;
        return uiMessage('validation.withField', {
            field: hasMessage(fieldKey) ? uiMessage(fieldKey) : field,
            message,
        });
    }
    return message;
}

/** detail ответа API → сообщение; null — в ответе нет ничего пригодного для показа. */
export function apiErrorMessage(detail: unknown): UiMessage | null {
    if (Array.isArray(detail)) return detail.length ? validationItemMessage(detail[0]) : null;
    if (detail && typeof detail === 'object') {
        const {code, params, message} = detail as { code?: unknown; params?: unknown; message?: unknown };
        return serverErrorMessage(code, params, message);
    }
    // Ответы без кода: стандартные ошибки FastAPI и прокси («Not Found», «Method Not Allowed»).
    return typeof detail === 'string' && detail ? {text: detail} : null;
}

/** Ошибка из ответа (тело читается один раз); null — тела нет или в нём нет ошибки. */
export async function readApiError(res: Response): Promise<UiMessage | null> {
    try {
        const data = await res.json();
        return apiErrorMessage(data?.detail);
    } catch {
        return null;
    }
}

/** Ошибка из ответа или запасное сообщение каталога. */
export async function readApiErrorOr(res: Response, fallback: MessageKey): Promise<UiMessage> {
    return (await readApiError(res)) ?? uiMessage(fallback);
}

/** Исключение с сообщением для показа: сервисы бросают его, компоненты показывают ui на языке игрока. */
export class UiError extends Error {
    readonly ui: UiMessage;

    constructor(ui: UiMessage) {
        super('text' in ui ? ui.text : ui.key);
        this.name = 'UiError';
        this.ui = ui;
    }
}

/** Сообщение из пойманного исключения: UiError — как есть, иначе (сеть, ошибка кода) — запасное. */
export function errorMessage(err: unknown, fallback: MessageKey): UiMessage {
    return err instanceof UiError ? err.ui : uiMessage(fallback);
}
