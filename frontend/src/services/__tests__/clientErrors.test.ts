// --- FILE: frontend/src/services/__tests__/clientErrors.test.ts ---
// Отчёты об ошибках страницы и след событий (breadcrumbs.ts, clientErrors.ts, номер запроса в http.ts): крошки
// переживают перезагрузку (sessionStorage), запрос несёт X-Request-ID, отчёт уходит на /client-errors со следом, без
// повторов и сверх предела, а собственные запросы отчёта в след не попадают.

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {addBreadcrumb, clearBreadcrumbs, getBreadcrumbs, newRequestId} from '../breadcrumbs';
import {reportClientError, resetClientErrorsForTests} from '../clientErrors';
import {apiRequest} from '../http';

function stubFetch(status = 200) {
    const fetchMock = vi.fn(async () => ({ok: status < 400, status, json: async () => ({}), headers: new Headers()}) as Response);
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

beforeEach(() => {
    sessionStorage.clear();
    clearBreadcrumbs();
    resetClientErrorsForTests();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('breadcrumbs', () => {
    it('хранит не больше 30 последних событий и сохраняет их в sessionStorage', () => {
        for (let i = 0; i < 35; i += 1) addBreadcrumb('route', `/page${i}`);
        const crumbs = getBreadcrumbs();
        expect(crumbs).toHaveLength(30);
        expect(crumbs[0].name).toBe('/page5');
        expect(JSON.parse(sessionStorage.getItem('regence_breadcrumbs') ?? '[]')).toHaveLength(30);
    });

    it('номер запроса — 16 безопасных символов (подходит под правило сервера)', () => {
        expect(newRequestId()).toMatch(/^[a-z0-9]{16}$/);
        expect(newRequestId()).not.toBe(newRequestId());
    });
});

describe('номер запроса в http.ts', () => {
    it('каждый запрос несёт X-Request-ID и оставляет крошку с методом, путём без параметров и статусом', async () => {
        const fetchMock = stubFetch();
        await apiRequest('/tournaments/2?full=1');
        const init = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        const headers = init[1].headers as Record<string, string>;
        expect(headers['X-Request-ID']).toMatch(/^[a-z0-9]{16}$/);
        expect(getBreadcrumbs()).toEqual([expect.objectContaining({
            kind: 'request', name: 'GET /tournaments/2', status: 200, request_id: headers['X-Request-ID'],
        })]);
    });

    it('обрыв сети тоже оставляет след', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
        await expect(apiRequest('/profile/me')).rejects.toBeTruthy();
        expect(getBreadcrumbs()[0].name).toBe('GET /profile/me (no connection)');
    });
});

describe('reportClientError', () => {
    it('шлёт отчёт на /client-errors со следом, а свой запрос в след не пишет', async () => {
        addBreadcrumb('socket', 'event move_made');
        const fetchMock = stubFetch(204);
        expect(await reportClientError('error', 'boom', 'stack-line')).toBe(true);
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toMatch(/\/api\/v1\/client-errors$/);
        const body = JSON.parse(String(init.body));
        expect(body).toMatchObject({kind: 'error', message: 'boom', stack: 'stack-line'});
        expect(body.breadcrumbs).toEqual([expect.objectContaining({name: 'event move_made'})]);
        expect(getBreadcrumbs()).toHaveLength(1);
    });

    it('не повторяет одно и то же сообщение и не шлёт больше десяти отчётов', async () => {
        const fetchMock = stubFetch(204);
        await reportClientError('error', 'same');
        expect(await reportClientError('error', 'same')).toBe(false);
        for (let i = 0; i < 12; i += 1) await reportClientError('error', `m${i}`);
        expect(fetchMock).toHaveBeenCalledTimes(10);
    });

    it('сбой отправки отчёта не бросает исключение', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
        await expect(reportClientError('render', 'x')).resolves.toBe(false);
    });
});
