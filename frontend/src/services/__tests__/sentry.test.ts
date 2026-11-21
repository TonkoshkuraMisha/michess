// --- FILE: frontend/src/services/__tests__/sentry.test.ts ---
// Sentry на странице (services/sentry.ts): без DSN — ничего не запускается и в сеть не ходит; с DSN — инициализация без
// личных данных и без записи экрана; ошибка отрисовки уходит в Sentry только при включённом DSN.

import {beforeEach, describe, expect, it, vi} from 'vitest';

const init = vi.fn();
const captureException = vi.fn();
vi.mock('@sentry/react', () => ({
    init: (options: unknown) => init(options),
    captureException: (...args: unknown[]) => captureException(...args),
    browserTracingIntegration: () => ({name: 'tracing'}),
}));

import {captureRenderError, initSentry, sentryEnabled} from '../sentry';

beforeEach(() => {
    init.mockClear();
    captureException.mockClear();
    vi.unstubAllEnvs();
    vi.stubEnv('VITE_SENTRY_DSN', '');  // не зависим от DSN в frontend/.env разработчика
});

describe('initSentry', () => {
    it('без DSN не запускает Sentry', () => {
        expect(sentryEnabled('')).toBe(false);
        expect(initSentry('')).toBe(false);
        expect(init).not.toHaveBeenCalled();
    });

    it('с DSN запускает без личных данных и без записи экрана', () => {
        expect(initSentry('https://key@o1.ingest.de.sentry.io/2')).toBe(true);
        const options = init.mock.calls[0][0] as Record<string, unknown>;
        expect(options).toMatchObject({dsn: 'https://key@o1.ingest.de.sentry.io/2'});
        expect(options).not.toHaveProperty('sendDefaultPii', true);
        expect(JSON.stringify(Object.keys(options))).not.toMatch(/replay/i);
        expect(options.tracesSampleRate).toBe(1.0); // в тестах не продакшен
    });
});

describe('captureRenderError', () => {
    it('без DSN ничего не отправляет', () => {
        captureRenderError(new Error('x'), 'stack');
        expect(captureException).not.toHaveBeenCalled();
    });

    it('с DSN отправляет ошибку со стеком компонентов', () => {
        vi.stubEnv('VITE_SENTRY_DSN', 'https://key@o1.ingest.de.sentry.io/2');
        const error = new Error('render failed');
        captureRenderError(error, 'in Page');
        expect(captureException).toHaveBeenCalledWith(error, {contexts: {react: {componentStack: 'in Page'}}});
    });
});
