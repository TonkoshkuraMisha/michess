// --- FILE: frontend/src/services/sentry.ts ---
// Sentry на странице (проект regence-web): сбор необработанных ошибок и ошибок отрисовки с трассировкой запросов.
// Включается только при заданном VITE_SENTRY_DSN (на сборке; для разработки — frontend/.env, для продакшена —
// build-аргумент frontend/Dockerfile): без него модуль ничего не делает и в сеть не ходит.
//
// Что НЕ включено: Session Replay и сбор личных данных (в @sentry/react 11 по умолчанию выключен) — запись экрана игрока противоречила бы
// сводке «Конфиденциальность» (components/PrivacyPage.tsx). Своё разбирательство «страница внезапно перезагрузилась» —
// отчёты и след событий в clientErrors.ts / breadcrumbs.ts (попадают в наш журнал сервера, а не в Sentry).
// Номер запроса X-Request-ID, который шлёт http.ts, виден в трассировке и связывает событие Sentry с журналом сервера.

import * as Sentry from '@sentry/react';

/** Доля запросов с трассировкой: в разработке — все, в продакшене — десятая часть (первое время, потом по нагрузке). */
const TRACES_SAMPLE_RATE_PROD = 0.1;

/** Включён ли Sentry в этой сборке (задан DSN). */
export function sentryEnabled(dsn: string | undefined = import.meta.env.VITE_SENTRY_DSN): boolean {
    return Boolean(dsn);
}

/** Запускает Sentry, если задан DSN; возвращает, запущен ли. Вызывается один раз из main.tsx. */
export function initSentry(dsn: string | undefined = import.meta.env.VITE_SENTRY_DSN): boolean {
    if (!sentryEnabled(dsn)) return false;
    Sentry.init({
        dsn,
        environment: import.meta.env.MODE,
        tracesSampleRate: import.meta.env.PROD ? TRACES_SAMPLE_RATE_PROD : 1.0,
        integrations: [Sentry.browserTracingIntegration()],
    });
    return true;
}

/** Передаёт пойманную ошибку отрисовки в Sentry (предохранитель страниц); без DSN — ничего. */
export function captureRenderError(error: Error, componentStack?: string | null): void {
    if (!sentryEnabled()) return;
    Sentry.captureException(error, {contexts: {react: {componentStack: componentStack ?? ''}}});
}
