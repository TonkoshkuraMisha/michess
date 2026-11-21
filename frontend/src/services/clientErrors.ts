// --- FILE: frontend/src/services/clientErrors.ts ---
// Отчёты об ошибках страницы на сервер (POST /api/v1/client-errors, src/api/client_errors.py). К каждому отчёту
// прикладывается след последних событий — «хлебные крошки» (breadcrumbs.ts: запросы с номером X-Request-ID, сообщения и
// закрытия WebSocket, смены страниц). Крошки ПЕРЕЖИВАЮТ перезагрузку страницы: если страница внезапно перезагрузилась
// (сбой, обновление сборки, ошибка), первый же отчёт новой страницы (kind «reload») несёт то, что происходило до неё.
//
// Что уходит: вид сбоя, короткое сообщение, стек, адрес страницы и крошки — без тел запросов, токенов и личных данных.
// Не чаще MAX_REPORTS отчётов за загрузку страницы и без повторов одного и того же сообщения. Сервер сверх своего лимита
// отчёты отбрасывает молча. Установка — installClientErrorReporting() в main.tsx; сеть — только через http.ts.

import {addBreadcrumb, CLIENT_ERRORS_PATH, getBreadcrumbs} from './breadcrumbs';
import {apiFetch} from './http';

/** Вид отчёта — совпадает с ClientErrorIn.kind на сервере. */
export type ReportKind = 'render' | 'error' | 'unhandledrejection' | 'socket' | 'reload';
const MAX_REPORTS = 10;
const MAX_MESSAGE = 500;
const MAX_STACK = 4000;
const MAX_URL = 300;

let reportsSent = 0;
const reportedMessages = new Set<string>();

/** Сброс счётчиков отчётов — только для тестов. */
export function resetClientErrorsForTests() {
    reportsSent = 0;
    reportedMessages.clear();
}

/** Отправляет отчёт (не бросает: сбой отчёта не должен вызывать новый сбой). Возвращает, ушёл ли он. */
export async function reportClientError(kind: ReportKind, message: string, stack?: string): Promise<boolean> {
    const text = (message || 'unknown error').slice(0, MAX_MESSAGE);
    const key = `${kind}:${text}`;
    if (reportsSent >= MAX_REPORTS || reportedMessages.has(key)) return false;
    reportedMessages.add(key);
    reportsSent += 1;
    try {
        await apiFetch(CLIENT_ERRORS_PATH, {
            method: 'POST',
            body: JSON.stringify({
                kind,
                message: text,
                ...(stack ? {stack: stack.slice(0, MAX_STACK)} : {}),
                url: `${window.location.pathname}${window.location.search}`.slice(0, MAX_URL),
                breadcrumbs: getBreadcrumbs(),
            }),
        });
        return true;
    } catch {
        return false;
    }
}

/** Тип перехода на страницу: 'reload' — обновление, 'navigate' — обычный заход, 'back_forward' и т. п. */
function navigationType(): string {
    const entry = typeof performance !== 'undefined' && performance.getEntriesByType
        ? performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
        : undefined;
    return entry?.type ?? 'navigate';
}

/**
 * Подключает сбор: window error и unhandledrejection, запись открытия страницы в крошки и, если страницу обновили
 * (reload), отчёт «reload» со следом до обновления. Вызывается один раз из main.tsx.
 */
export function installClientErrorReporting() {
    const type = navigationType();
    const previous = getBreadcrumbs();
    addBreadcrumb('route', `${window.location.pathname} (${type})`);
    if (type === 'reload' && previous.length > 0) {
        addBreadcrumb('reload', 'page reloaded');
        void reportClientError('reload', 'page reloaded');
    }
    window.addEventListener('error', (event) => {
        void reportClientError('error', event.message || String(event.error), event.error instanceof Error ? event.error.stack : undefined);
    });
    window.addEventListener('unhandledrejection', (event) => {
        const reason: unknown = event.reason;
        void reportClientError('unhandledrejection', reason instanceof Error ? reason.message : String(reason),
            reason instanceof Error ? reason.stack : undefined);
    });
}
